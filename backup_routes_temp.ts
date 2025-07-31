import express, { type Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertCareerAssessmentSchema, 
  insertSkillSchema, 
  insertJobSearchStrategySchema,
  insertAppointmentSchema,
  insertResumeReviewSchema,
  insertResourceSchema,
  insertContactMessageSchema,
  insertFeedbackSchema
} from "@shared/schema";
import { z } from "zod";
import { analyzeWithAI, AIAnalysisOptions, checkOpenAIConnection } from './services/openai';
import OpenAI from 'openai';
import { getChatbotResponse, getFallbackResponse } from './services/chatbot';
import { generateRAGResponse, logUserQuery } from './utils/rag';
import { sendEmail } from './sendgrid';
import { aiRateLimiter, generalRateLimiter } from './middleware/rateLimiter';
import { errorLoggingMiddleware, requestLoggingMiddleware, logAIError } from './middleware/errorLogger';
// Vi vil importere fra servicesne dynamisk senere
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { getAllApplicationTemplates, getApplicationTemplateById } from './services/applicationTemplateService';
import { getIntegrationStatus, enhanceTemplateMetadata } from './services/canvaIntegrationService';
import { setupAuth, isAuthenticated, hasGivenConsent, isAdmin } from './auth';
import { registerApplicationRoutes } from './applicationRoutes';

// De fire LinkedIn artikler til ressourcebiblioteket
const linkedInResources = [
  {
    title: "Sådan bruger du LinkedIn",
    description: "En komplet guide til at bruge LinkedIn-platformen effektivt i din jobsøgning og karriereudvikling.",
    url: "https://www.finduddannelse.dk/artikler/tips-og-vejledninger/saadan-bruger-man-linkedin-8702",
    category: "linkedin",
    resourceType: "article",
    imageUrl: null
  },
  {
    title: "5 tips til din jobsøgning på LinkedIn",
    description: "Praktiske råd til at optimere din jobsøgning gennem LinkedIn's mange funktioner.",
    url: "https://ballisager.com/blog/5-tips-til-din-jobsoegning-paa-linkedin",
    category: "linkedin",
    resourceType: "article",
    imageUrl: null
  },
  {
    title: "Fem spændende tendenser til dig der søger nyt job",
    description: "Indsigt i de nyeste tendenser på jobmarkedet du bør være opmærksom på i din jobsøgning.",
    url: "https://www.aka.dk/akademikerliv/artikler/fem-spaendende-tendenser-til-dig-der-soeger-nyt-job/",
    category: "jobsøgning",
    resourceType: "article",
    imageUrl: null
  },
  {
    title: "Jobsøgning på LinkedIn - Ultimativ guide",
    description: "Den komplette guide til at bruge LinkedIn effektivt i din jobsøgningsproces.",
    url: "https://jofibo.com/da/blog/jobsoegning-paa-linkedin",
    category: "linkedin",
    resourceType: "article",
    imageUrl: null
  }
];

// Funktion til at tilføje ressourcerne når serveren starter
async function initializeResources() {
  try {
    // 1. Tjek og tilføj LinkedIn-artikler
    console.log('Checker om artikler allerede findes...');
    const existingArticles = await storage.getResourcesByType('article');
    
    if (existingArticles.length === 0) {
      console.log('Ingen artikler fundet. Tilføjer LinkedIn-artikler...');
      
      for (const resource of linkedInResources) {
        const createdResource = await storage.createResource(resource);
        console.log(`Artikel tilføjet: ${createdResource.title}`);
      }
      
      console.log('Alle LinkedIn-artikler er blevet tilføjet til ressourcebiblioteket!');
    } else {
      console.log(`${existingArticles.length} artikler fundet. Springer over artikel-initialisering.`);
    }
    
    // 2. Tjek og tilføj prompts
    console.log('Checker om prompts allerede findes...');
    const existingPrompts = await storage.getResourcesByType('prompt');
    
    if (existingPrompts.length === 0) {
      console.log('Ingen prompts fundet. Tilføjer prompts...');
      
      // Prompts til jobsøgning (nogle gratis, nogle premium)
      const jobSearchPrompts = [
        // Gratis prompts - CV kategori
        {
          title: "Optimér dit CV til specifik stillingsopslag",
          description: "En prompt der hjælper dig med at skræddersy dit CV til et bestemt stillingsopslag ved at fremhæve relevante kompetencer og erfaringer.",
          url: "/attached_assets/50 varierede prompts til din jobstrategi.pdf",
          category: "cv",
          resourceType: "prompt",
          isPremium: false,
          promptText: "Jeg har et CV og en jobannonce. Hjælp mig med at identificere de vigtigste nøglekompetencer og erfaringer fra mit CV, der matcher jobannoncen, og foreslå konkrete ændringer til mit CV, så det passer bedre til stillingen. Mit CV er som følger: [INDSÆT CV] Jobannoncen er: [INDSÆT JOBANNONCE]"
        },
        {
          title: "Identificér mine unikke kompetencer til CV",
          description: "Få hjælp til at identificere og fremhæve dine unikke kompetencer og styrker, så dit CV skiller sig ud.",
          url: "#",
          category: "cv",
          resourceType: "prompt",
          isPremium: false,
          promptText: "Jeg har brug for at identificere mine unikke kompetencer til mit CV. Min erhvervserfaring er: [INDSÆT ERHVERVSERFARING]. Hjælp mig med at identificere mine specielle styrker, kompetencer og unikke selling points (USP'er), som jeg bør fremhæve i mit CV og min jobansøgning for at skille mig ud fra andre ansøgere."
        },
        {
          title: "Forbedring af CV-formuleringer",
          description: "Få hjælp til at forbedre formuleringerne i dit CV for at gøre det mere præcist, professionelt og virkningsfuldt.",
          url: "#",
          category: "cv",
          resourceType: "prompt",
          isPremium: false,
          promptText: "Jeg vil gerne forbedre formuleringerne i mit CV. Her er et afsnit fra mit CV: [INDSÆT CV-AFSNIT]. Kan du hjælpe mig med at gøre sprogbrugen mere præcis, professionel og wirkningsfuld? Fokuser på at gøre beskrivelserne mere handlingsorienterede og resultatorienterede. Bevar alle faktiske oplysninger, men gør sproget mere overbevisende."
        },
        
        // Gratis prompts - Jobsamtale kategori
        {
          title: "STAR-metoden til jobsamtale-forberedelse",
          description: "Lær at strukturere dine svar ved jobsamtaler ved hjælp af STAR-metoden (Situation, Task, Action, Result).",
          url: "#",
          category: "jobsamtale",
          resourceType: "prompt",
          isPremium: false,
          promptText: "Hjælp mig med at forberede et STAR-struktureret svar til følgende jobsamtalespørgsmål: [INDSÆT SPØRGSMÅL]. Jeg vil gerne have hjælp til at strukturere mit svar efter STAR-metoden (Situation, Task, Action, Result), så jeg kan præsentere min erfaring effektivt og konkret."
        },
        {
          title: "Forberedelse til svære jobsamtalespørgsmål",
          description: "Få hjælp til at forberede overbevisende svar på vanskelige og udfordrende jobsamtalespørgsmål.",
          url: "#",
          category: "jobsamtale",
          resourceType: "prompt",
          isPremium: false,
          promptText: "Jeg har en jobsamtale til en stilling som [JOBTITEL]. Giv mig de 5 sværeste spørgsmål, jeg sandsynligvis vil få, og hjælp mig med at forberede professionelle og ærlige svar på hvert spørgsmål. Inkluder især spørgsmål om mine svagheder, huller i CV'et eller manglende erfaring, og hvordan jeg kan tackle dem positivt."
        },
        
        // Gratis prompts - Ansøgning kategori
        {
          title: "Skab en målrettet jobansøgning",
          description: "Få hjælp til at skrive en overbevisende og målrettet jobansøgning, der matcher jobopslaget og fremhæver dine relevante kompetencer.",
          url: "#",
          category: "ansøgning",
          resourceType: "prompt",
          isPremium: false,
          promptText: "Jeg vil gerne skrive en overbevisende ansøgning til følgende job: [INDSÆT JOBOPSLAG]. Mit CV indeholder følgende nøglekompetencer og erfaringer: [INDSÆT NØGLEKOMPETENCER]. Hjælp mig med at skabe en målrettet ansøgning, der klart viser, hvordan mine kompetencer og erfaringer matcher jobkravene. Brug en professionel og engagerende tone, og sørg for at strukturere ansøgningen med en stærk indledning, relevante eksempler på mine præstationer, og en overbevisende afslutning."
        },
        
        // Gratis prompts - LinkedIn kategori
        {
          title: "Skab et konkret pitch til netværksmøder",
          description: "Få hjælp til at udarbejde et kort og effektivt pitch, der kan bruges til netværksmøder og konferencer.",
          url: "#",
          category: "linkedin",
          resourceType: "prompt",
          isPremium: false,
          promptText: "Lav en pitch, jeg kan bruge i netværkssammenhænge, hvor jeg kort forklarer mit brancheskift fra [TIDLIGERE BRANCHE] til [NY BRANCHE]. Pitchen skal være cirka 30 sekunder lang, professionel og engagerende. Den skal indeholde: 1) Hvem jeg er, 2) Hvad jeg søger, 3) Hvorfor mit skift giver mening, 4) Mine vigtigste overførbare kompetencer."
        },
        {
          title: "Optimér dit LinkedIn resume",
          description: "Få hjælp til at skrive et fængende og professionelt LinkedIn-resumé, der fanger rekrutterers opmærksomhed.",
          url: "#",
          category: "linkedin",
          resourceType: "prompt",
          isPremium: false,
          promptText: "Jeg skal optimere mit LinkedIn-resumé/beskrivelse. Min nuværende rolle er [JOBTITEL] med erfaring inden for [OMRÅDER]. Mine karrieremål er [MÅL]. Hjælp mig med at skrive et professionelt, engagerende og søgeoptimeret LinkedIn-resumé på 2-3 afsnit, der fremhæver mine styrker, viser min personlighed, og indeholder relevante nøgleord for min branche."
        },
        
        // Gratis prompts - Jobsøgning kategori
        {
          title: "Udvikling af jobsøgningsstrategi",
          description: "Få hjælp til at udvikle en effektiv og struktureret jobsøgningsstrategi, der er tilpasset dine mål og din situation.",
          url: "#",
          category: "jobsøgning",
          resourceType: "prompt",
          isPremium: false,
          promptText: "Jeg er [NUVÆRENDE SITUATION, f.eks. 'jobsøgende', 'ønsker karriereskift', 'nyuddannet'] inden for [BRANCHE/FELT] og søger job som [JOBTITEL]. Hjælp mig med at udvikle en struktureret jobsøgningsstrategi for de næste 30 dage. Inkluder: 1) Bedste jobsøgningskanaler for min situation, 2) Ugentlige mål og aktiviteter, 3) Netværksstrategi, 4) Metoder til at skille mig ud, og 5) Hvordan jeg holder motivationen."
        },
        
        // Premium prompts - CV kategori
        {
          title: "Analyse af nøgleord til ATS-optimering",
          description: "Analysér og identificér de mest effektive nøgleord at inkludere i dit CV for at passere ATS-systemer.",
          url: "#",
          category: "cv",
          resourceType: "prompt",
          isPremium: true,
          promptText: "Analyser dette jobopslag: [INDSÆT TEKST]. Hvilke nøgleord bør fremgå i mit CV for at passere ATS-systemer, og hvordan matcher mine følgende erfaringer de vigtigste krav? [INDSÆT CV-ERFARINGER]"
        },
        {
          title: "CV-transformation for karriereskift",
          description: "Få hjælp til at omskrive dit CV, så det matcher din nye ønskede branche og fremhæver overførbare kompetencer.",
          url: "#",
          category: "cv",
          resourceType: "prompt",
          isPremium: true,
          promptText: "Jeg overvejer et karriereskift fra [NUVÆRENDE BRANCHE/ROLLE] til [ØNSKET BRANCHE/ROLLE]. Mit nuværende CV er: [INDSÆT CV]. Hjælp mig med at transformere mit CV, så det appellerer til arbejdsgivere i min nye ønskede branche. Fremhæv overførbare kompetencer, omformulér joberfaring, så den virker relevant, og foreslå ændringer i strukturen, der kan minimere fokus på manglende direkte erfaring."
        },
        
        // Premium prompts - LinkedIn kategori
        {
          title: "LinkedIn-profil optimering for karriereskift",
          description: "En premium prompt til at omskrive din LinkedIn-profil, når du ønsker at skifte karrierevej eller branche.",
          url: "#",
          category: "linkedin",
          resourceType: "prompt",
          isPremium: true,
          promptText: "Jeg overvejer et karriereskift fra [NUVÆRENDE BRANCHE/ROLLE] til [ØNSKET BRANCHE/ROLLE]. Hjælp mig med at omskrive min LinkedIn-profil, så den appellerer til arbejdsgivere i min nye ønskede branche, samtidig med at den fremhæver mine overførbare kompetencer. Min nuværende profil er: [INDSÆT PROFIL]"
        },
        {
          title: "LinkedIn strategi for aktiv jobsøgning",
          description: "Få en komplet strategi for at bruge LinkedIn effektivt i en aktiv jobsøgning, inklusive opslag, kommentering og netværk.",
          url: "#",
          category: "linkedin",
          resourceType: "prompt",
          isPremium: true,
          promptText: "Jeg søger aktivt job som [STILLINGSBETEGNELSE] og vil bruge LinkedIn strategisk i min jobsøgning. Jeg har [ANTAL] forbindelser og er [AKTIV/PASSIV] på platformen. Lav en detaljeret 30-dages LinkedIn-strategi for mig med: 1) Typer af indhold, jeg bør poste ugentligt, 2) Hvordan jeg bør engagere mig med andre og hvilke personer, 3) Hvordan jeg bør kontakte rekrutterere og potentielle arbejdsgivere, 4) Tidspunkter og frekvens for aktivitet, og 5) Avancerede søgemetoder til at finde relevante jobmuligheder."
        },
        
        // Premium prompts - Jobsamtale kategori
        {
          title: "Komplet jobsamtalestrategiplan",
          description: "Få en omfattende strategiplan for at forberede og mestre en specifik jobsamtale, inklusiv research, spørgsmål, svar og følgeproces.",
          url: "#",
          category: "jobsamtale",
          resourceType: "prompt",
          isPremium: true,
          promptText: "Jeg har en jobsamtale hos [VIRKSOMHED] til stillingen som [JOBTITEL] om [ANTAL] dage. Baseret på dette jobopslag: [INDSÆT JOBOPSLAG], og min baggrund: [KORT OM DIN BAGGRUND], skab en komplet strategi for, hvordan jeg bedst forbereder mig, gennemfører samtalen og følger op. Inkluder: 1) Detaljeret researchplan for virksomheden og interviewer(e), 2) Top 10 spørgsmål, jeg vil blive stillet, med optimale svar, 3) 5-7 gennemtænkte spørgsmål, jeg bør stille, 4) Hvordan jeg håndterer spørgsmål om løn, 5) Strategi for at skille mig ud, og 6) Opfølgningsplan efter samtalen."
        }
      ];
      
      for (const prompt of jobSearchPrompts) {
        try {
          const createdPrompt = await storage.createResource(prompt);
          console.log(`Prompt tilføjet: ${createdPrompt.title} (${createdPrompt.isPremium ? 'Premium' : 'Gratis'})`);
        } catch (error) {
          console.error(`Fejl ved oprettelse af prompt: ${prompt.title}`, error);
        }
      }
      
      console.log('Alle prompts er blevet tilføjet!');
    } else {
      console.log(`${existingPrompts.length} prompts fundet. Springer over prompt-initialisering.`);
    }
    
    // 3. Tjek og tilføj cheat sheets
    console.log('Checker om cheat sheets allerede findes...');
    const existingCheatSheets = await storage.getResourcesByType('cheatsheet');
    
    if (existingCheatSheets.length === 0) {
      console.log('Ingen cheat sheets fundet. Tilføjer cheat sheets...');
      
      // Cheat sheets (nogle gratis, nogle premium)
      const cheatSheets = [
        // Gratis cheat sheets - CV kategori
        {
          title: "Den ultimative guide til CV-struktur",
          description: "En omfattende vejledning til at strukturere dit CV optimalt afhængigt af din branche og erfaring.",
          url: "/assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "cv",
          resourceType: "cheatsheet",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "CV Skabelon Tjekliste",
          description: "En detaljeret tjekliste til at sikre, at din CV-skabelon indeholder alle nødvendige elementer og er optimalt struktureret.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "cv",
          resourceType: "cheatsheet",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "ATS-venligt CV: Nøgleord tjekliste",
          description: "Guide til at sikre at dit CV passerer Applicant Tracking Systems (ATS) med en tjekliste over nøgleord og formatering.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "cv",
          resourceType: "cheatsheet",
          isPremium: false,
          imageUrl: null
        },
        
        // Gratis cheat sheets - LinkedIn kategori
        {
          title: "10 tips til at netværke effektivt på LinkedIn",
          description: "Konkrete strategier til at udvide dit professionelle netværk og skabe værdifulde forbindelser på LinkedIn.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "linkedin",
          resourceType: "cheatsheet",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "LinkedIn Profil Optimering",
          description: "En guide til at forbedre alle dele af din LinkedIn-profil for maksimal synlighed og rekrutterappeal.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "linkedin",
          resourceType: "cheatsheet",
          isPremium: false,
          imageUrl: null
        },
        
        // Gratis cheat sheets - Jobsøgning kategori
        {
          title: "Guide til at håndtere afslag positivt",
          description: "Lær hvordan du kan bruge afslag konstruktivt til at forbedre din jobsøgningsstrategi.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "jobsøgning",
          resourceType: "cheatsheet",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "Jobsøgningskanaler: Fordele og ulemper",
          description: "En sammenligning af forskellige jobsøgningskanaler og hvordan du bedst udnytter hver enkelt i din strategi.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "jobsøgning",
          resourceType: "cheatsheet",
          isPremium: false,
          imageUrl: null
        },
        
        // Gratis cheat sheets - Jobsamtale kategori
        {
          title: "STAR-metode eksempelskabelon",
          description: "Konkrete eksempler på brug af STAR-metoden til at strukturere dine svar ved jobsamtaler.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "jobsamtale",
          resourceType: "cheatsheet",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "Typiske jobsamtalespørgsmål og gode svar",
          description: "Liste over de mest almindelige jobsamtalespørgsmål og eksempler på stærke svar til hvert spørgsmål.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "jobsamtale",
          resourceType: "cheatsheet",
          isPremium: false,
          imageUrl: null
        },
        
        // Premium cheat sheets - Jobsamtale kategori
        {
          title: "Forberedelse til jobsamtaler i teknologibranchen",
          description: "Specifik vejledning til jobsamtaler i tech-virksomheder med typiske spørgsmål og bedste svar.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "jobsamtale",
          resourceType: "cheatsheet",
          isPremium: true,
          imageUrl: null
        },
        {
          title: "Kropssprog og non-verbal kommunikation til jobsamtaler",
          description: "Ekspertguide til at mestre kropssprog, stemmeføring og non-verbal kommunikation for at styrke din præsentation ved jobsamtaler.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "jobsamtale",
          resourceType: "cheatsheet",
          isPremium: true,
          imageUrl: null
        },
        
        // Premium cheat sheets - Jobsøgning kategori
        {
          title: "30-dages jobsøgningsstrategi",
          description: "En detaljeret daglig plan for at optimere din jobsøgning over en 30-dages periode.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "jobsøgning",
          resourceType: "cheatsheet",
          isPremium: true,
          imageUrl: null
        },
        {
          title: "Det skjulte jobmarked: Guide til uopfordrede ansøgninger",
          description: "Komplet guide til at finde og søge job, der aldrig bliver slået op, gennem uopfordrede ansøgninger og netværk.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "jobsøgning",
          resourceType: "cheatsheet",
          isPremium: true,
          imageUrl: null
        },
        
        // Premium cheat sheets - Ansøgning kategori
        {
          title: "Branchespecifikke ansøgningstemplates",
          description: "Skræddersyede ansøgningsskabeloner optimeret til forskellige brancher og jobniveauer.",
          url: "/attached_assets/Cheat sheets til jobsøgning og jobstrategi.pdf",
          category: "ansøgning",
          resourceType: "cheatsheet",
          isPremium: true,
          imageUrl: null
        }
      ];
      
      for (const cheatSheet of cheatSheets) {
        try {
          const createdCheatSheet = await storage.createResource(cheatSheet);
          console.log(`Cheat sheet tilføjet: ${createdCheatSheet.title} (${createdCheatSheet.isPremium ? 'Premium' : 'Gratis'})`);
        } catch (error) {
          console.error(`Fejl ved oprettelse af cheat sheet: ${cheatSheet.title}`, error);
        }
      }
      
      console.log('Alle cheat sheets er blevet tilføjet!');
    } else {
      console.log(`${existingCheatSheets.length} cheat sheets fundet. Springer over cheat sheet-initialisering.`);
    }
    
    // 4. Tjek og tilføj FAQs
    console.log('Checker om FAQs allerede findes...');
    const existingFAQs = await storage.getResourcesByType('faq');
    
    if (existingFAQs.length === 0) {
      console.log('Ingen FAQs fundet. Tilføjer FAQs...');
      
      // FAQ-spørgsmål og svar til ressourcer
      const faqs = [
        {
          title: "Hvordan får jeg mest ud af CV-feedback?",
          description: "Guide til at få mest muligt ud af vores CV-feedback-funktion og hvordan du implementerer forbedringsforslagene.",
          url: "#",
          category: "cv",
          resourceType: "faq",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "Hvad er de mest almindelige fejl i jobansøgninger?",
          description: "En oversigt over typiske fejl i jobansøgninger og hvordan du undgår dem for at øge dine chancer for at blive kaldt til samtale.",
          url: "#",
          category: "ansøgning",
          resourceType: "faq",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "Hvordan bruger jeg STAR-metoden effektivt?",
          description: "Praktisk guide til at anvende STAR-metoden (Situation, Task, Action, Result) til at strukturere dine svar på jobsamtaler.",
          url: "#",
          category: "jobsamtale",
          resourceType: "faq", 
          isPremium: false,
          imageUrl: null
        },
        {
          title: "Hvornår bør jeg opdatere min LinkedIn-profil?",
          description: "Anbefalinger til hvornår og hvor ofte du bør opdatere din LinkedIn-profil for at maksimere din synlighed og jobmuligheder.",
          url: "#",
          category: "linkedin",
          resourceType: "faq",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "Hvordan kan jeg finde min karrierevej?",
          description: "Praktiske råd til at identificere den rette karrierevej baseret på dine interesser, kompetencer og præferencer.",
          url: "#",
          category: "karriereudvikling",
          resourceType: "faq",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "Hvad er forskellen mellem faglige og personlige kompetencer?",
          description: "Forklaring på forskellen mellem faglige og personlige kompetencer, og hvorfor begge er vigtige i din jobsøgning.",
          url: "#",
          category: "kompetencer",
          resourceType: "faq",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "Hvordan håndterer jeg huller i mit CV?",
          description: "Strategier til at præsentere perioder uden arbejde på en positiv og ærlig måde i dit CV og til jobsamtaler.",
          url: "#",
          category: "cv",
          resourceType: "faq",
          isPremium: false,
          imageUrl: null
        },
        {
          title: "Hvordan skiller jeg mig ud fra andre ansøgere?",
          description: "Konkrete tips til at differentiere dig fra andre jobansøgere gennem din ansøgning, CV og til jobsamtalen.",
          url: "#",
          category: "jobsøgning",
          resourceType: "faq",
          isPremium: false,
          imageUrl: null
        }
      ];
      
      for (const faq of faqs) {
        try {
          const createdFAQ = await storage.createResource(faq);
          console.log(`FAQ tilføjet: ${createdFAQ.title}`);
        } catch (error) {
          console.error(`Fejl ved oprettelse af FAQ: ${faq.title}`, error);
        }
      }
      
      console.log('Alle FAQs er blevet tilføjet!');
    } else {
      console.log(`${existingFAQs.length} FAQs fundet. Springer over FAQ-initialisering.`);
    }
  } catch (error) {
    console.error('Fejl ved initialisering af ressourcer:', error);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Global middleware
  app.use(requestLoggingMiddleware);
  
  // Opsæt autentificering
  setupAuth(app);
  
  // Tilføj statisk fil server for at kunne serve PDF-filer fra attached_assets mappen
  app.use('/assets', express.static(path.join(process.cwd(), 'attached_assets')));
  
  // Serve test debug siden
  app.get('/test-cv-debug.html', (req: Request, res: Response) => {
    const filePath = path.join(process.cwd(), 'public', 'test-cv-debug.html');
    res.sendFile(filePath);
  });
  
  // Serve frontend test siden
  app.get('/test-cv-frontend.html', (req: Request, res: Response) => {
    const filePath = path.join(process.cwd(), 'public', 'test-cv-frontend.html');
    res.sendFile(filePath);
  });
  
  // Initialiser ressourcer ved serverstart
  await initializeResources();
  
  // 404 Error Logging endpoint
  app.post("/api/log-404", async (req: Request, res: Response) => {
    try {
      const { url, referrer, userAgent, timestamp } = req.body;
      
      // Log 404-fejl til console og potentielt til database
      console.log(`404 FEJL LOGGET:`, {
        url,
        referrer,
        userAgent,
        timestamp,
        ip: req.ip || req.connection.remoteAddress
      });
      
      // Her kunne du tilføje database-logging hvis ønsket
      // await storage.log404Error({ url, referrer, userAgent, timestamp, ip: req.ip });
      
      res.json({ success: true, message: "404 fejl logget" });
    } catch (error) {
      console.error("Fejl ved logging af 404:", error);
      res.status(500).json({ success: false, message: "Kunne ikke logge 404 fejl" });
    }
  });

  // Admin endpoints til beta feedback
  app.get('/api/admin/beta-feedback', async (req, res) => {
    try {
      const betaFeedback = await storage.getAllBetaFeedback();
      res.json(betaFeedback);
    } catch (error) {
      console.error('Fejl ved hentning af beta feedback:', error);
      res.status(500).json({ message: 'Kunne ikke hente beta feedback' });
    }
  });

  app.get('/api/admin/beta-feedback-stats', async (req, res) => {
    try {
      const stats = await storage.getBetaFeedbackStats();
      res.json(stats);
    } catch (error) {
      console.error('Fejl ved hentning af feedback statistikker:', error);
      res.status(500).json({ message: 'Kunne ikke hente statistikker' });
    }
  });

  // PDF generation endpoint for resources
  app.post('/api/generate-pdf', async (req: Request, res: Response) => {
    try {
      const { title, content, resourceType } = req.body;
      
      if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
      }

      // Create HTML content for PDF
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              margin: 40px; 
              line-height: 1.6; 
              color: #333;
            }
            h1 { 
              color: #6366f1; 
              border-bottom: 2px solid #6366f1; 
              padding-bottom: 10px;
              margin-bottom: 20px;
            }
            .content { 
              margin-top: 20px;
              white-space: pre-wrap;
            }
            .footer {
              margin-top: 40px;
              font-size: 12px;
              color: #666;
              border-top: 1px solid #eee;
              padding-top: 10px;
            }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div class="content">${content}</div>
          <div class="footer">
            Type: ${resourceType || 'resource'}<br>
            Genereret: ${new Date().toLocaleDateString('da-DK')}<br>
            Kilde: Karriere Kompasset
          </div>
        </body>
        </html>
      `;

      // Set headers for HTML response (fallback when PDF generation not available)
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${title.replace(/[^a-z0-9]/gi, '_')}.html"`);
      
      res.send(htmlContent);
    } catch (error) {
      console.error('PDF generation error:', error);
      res.status(500).json({ error: 'PDF generation failed' });
    }
  });

  // API-status endpoint - fortæller om OpenAI API er tilgængeligt
  app.get("/api/status", async (_req: Request, res: Response) => {
    try {
      console.log("Checking OpenAI connection status...");
      const connected = await checkOpenAIConnection();
      console.log("OpenAI connection status:", connected);
      
      // Sørg for at sende korrekt Content-Type header til JSON
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify({ connected }));
    } catch (error) {
      console.error("Error checking OpenAI status:", error);
      res.setHeader('Content-Type', 'application/json');
      res.status(500).send(JSON.stringify({ connected: false, error: "Kunne ikke kontrollere API-status" }));
    }
  });
  
  // Tjek Canva-integrationens status
  app.get("/api/canva-integration/status", (_req: Request, res: Response) => {
    try {
      const status = getIntegrationStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ 
        isAvailable: false, 
        message: "Kunne ikke hente integrationsstatus", 
        error: error?.message || 'Ukendt fejl'
      });
    }
  });
  
  // Endpoint til at forbedre en CV-skabelons metadata med AI
  app.post("/api/canva-integration/enhance-template", async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ 
          message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." 
        });
      }
      
      const { template } = req.body;
      
      if (!template || !template.id) {
        return res.status(400).json({ message: "Skabeloninformation er påkrævet" });
      }
      
      const enhancedTemplate = await enhanceTemplateMetadata(template);
      res.json({ template: enhancedTemplate });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ 
        message: "Der opstod en fejl under optimering af skabelon-metadata", 
        error: errorMessage 
      });
    }
  });
  
  // Career assessment endpoints
  
  // Hent seneste udkast for en bruger
  app.get("/api/career-assessment/user/:userId/draft", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      
      // Hent alle brugerens vurderinger
      const userAssessments = await storage.getCareerAssessmentsByUserId(userId);
      
      if (!userAssessments || userAssessments.length === 0) {
        // Ingen vurderinger fundet for brugeren
        return res.status(404).json({ message: "Ingen karrierevurderinger fundet for brugeren" });
      }
      
      // Find den seneste udkast baseret på updatedAt tidsstempel
      const latestDraft = userAssessments
        .filter(assessment => assessment.status === "draft")
        .sort((a, b) => {
          const dateA = new Date(a.updatedAt || a.createdAt);
          const dateB = new Date(b.updatedAt || b.createdAt);
          return dateB.getTime() - dateA.getTime(); // Sortér faldende (nyeste først)
        })[0];
      
      if (!latestDraft) {
        // Ingen udkast fundet
        return res.status(404).json({ message: "Ingen ufærdige karrierevurderinger fundet for brugeren" });
      }
      
      res.json(latestDraft);
    } catch (error) {
      console.error("Fejl ved hentning af brugerens seneste udkast:", error);
      res.status(500).json({ message: "Der opstod en fejl ved hentning af den seneste ufærdige vurdering" });
    }
  });
  
  app.post("/api/career-assessment", async (req: Request, res: Response) => {
    try {
      console.log("Modtog karrierevurdering data:", JSON.stringify(req.body));
      
      try {
        // Forsøg at validere data og log eventuelle fejl
        const validationResult = insertCareerAssessmentSchema.safeParse(req.body);
        if (!validationResult.success) {
          console.error("Validationsfejl:", JSON.stringify(validationResult.error.errors));
        }
      } catch (validationError) {
        console.error("Fejl ved validering:", validationError);
      }
      
      // Tilføj manglende felter hvis de ikke er angivet
      const requestData = {
        ...req.body,
        title: req.body.title || "Karrierevurdering",
        status: req.body.status || "in_progress"
      };
      
      console.log("Forsøger at validere med tilføjede felter:", JSON.stringify(requestData));
      
      const validatedData = insertCareerAssessmentSchema.parse(requestData);
      console.log("Validering gennemført:", validatedData);
      
      // Tjek om brugeren allerede har en karrierevurdering
      if (validatedData.userId) {
        const existingAssessments = await storage.getCareerAssessmentsByUserId(validatedData.userId);
        
        // Hvis brugeren allerede har en karrierevurdering, opdater den
        if (existingAssessments.length > 0) {
          const existingAssessment = existingAssessments[0]; // Tag den første (seneste) vurdering
          const updatedAssessment = await storage.updateCareerAssessmentAnswers(
            existingAssessment.id, 
            validatedData.answers
          );
          
          if (updatedAssessment) {
            return res.status(200).json(updatedAssessment);
          }
        }
      }
      
      // Hvis ingen eksisterende vurdering blev fundet, opret en ny
      const assessment = await storage.createCareerAssessment(validatedData);
      res.status(201).json(assessment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("Zod validationsfejl:", JSON.stringify(error.errors));
        res.status(400).json({ message: "Ugyldig inputdata", errors: error.errors });
      } else {
        console.error("Fejl ved karrierevurdering:", error);
        res.status(500).json({ message: "Der opstod en fejl ved oprettelse af karrierevurdering" });
      }
    }
  });

  app.get("/api/career-assessment/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const assessment = await storage.getCareerAssessment(id);
      
      if (!assessment) {
        return res.status(404).json({ message: "Karrierevurdering ikke fundet" });
      }
      
      res.json(assessment);
    } catch (error) {
      res.status(500).json({ message: "Der opstod en fejl ved hentning af karrierevurdering" });
    }
  });

  app.put("/api/career-assessment/:id/result", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { result } = req.body;
      
      const updatedAssessment = await storage.updateCareerAssessmentResult(id, result);
      
      if (!updatedAssessment) {
        return res.status(404).json({ message: "Karrierevurdering ikke fundet" });
      }
      
      res.json(updatedAssessment);
    } catch (error) {
      res.status(500).json({ message: "Der opstod en fejl ved opdatering af resultat" });
    }
  });
  
  // Opdater en eksisterende karrierevurdering
  app.put("/api/career-assessment/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { answers, status, questions } = req.body;
      
      // Hent den eksisterende vurdering
      const assessment = await storage.getCareerAssessment(id);
      
      if (!assessment) {
        return res.status(404).json({ message: "Karrierevurdering ikke fundet" });
      }
      
      // Opdater svar hvis de er angivet
      let updatedAssessment = assessment;
      if (answers) {
        const answerResult = await storage.updateCareerAssessmentAnswers(id, answers);
        if (answerResult) {
          updatedAssessment = answerResult;
        }
      }
      
      // Opdater status hvis den er angivet
      if (status) {
        const statusResult = await storage.updateCareerAssessmentStatus(id, status);
        if (statusResult) {
          updatedAssessment = statusResult;
        }
      }
      
      res.json(updatedAssessment);
    } catch (error) {
      console.error("Fejl ved opdatering af karrierevurdering:", error);
      res.status(500).json({ message: "Der opstod en fejl ved opdatering af karrierevurdering" });
    }
  });
  
  // Gem en kladde af karrierevurderingen (auto-save)
  app.put("/api/career-assessment/:id/autosave", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { answers, status } = req.body;
      
      // Hent den eksisterende vurdering
      const assessment = await storage.getCareerAssessment(id);
      
      if (!assessment) {
        return res.status(404).json({ message: "Karrierevurdering ikke fundet" });
      }
      
      // Opdater svar hvis de er angivet
      let updatedAssessment = assessment;
      if (answers) {
        const answerResult = await storage.updateCareerAssessmentAnswers(id, answers);
        if (answerResult) {
          updatedAssessment = answerResult;
        }
      }
      
      // Opdater status hvis den er angivet (typisk "draft")
      if (status) {
        const statusResult = await storage.updateCareerAssessmentStatus(id, status);
        if (statusResult) {
          updatedAssessment = statusResult;
        }
      }
      
      res.json(updatedAssessment);
    } catch (error) {
      console.error("Fejl ved autosave af karrierevurdering:", error);
      res.status(500).json({ message: "Der opstod en fejl ved automatisk gem af karrierevurdering" });
    }
  });
  
  // Gem karrierevurdering i profil
  app.post("/api/career-assessment/save-to-profile", async (req: Request, res: Response) => {
    try {
      const { assessmentId } = req.body;
      
      if (!assessmentId) {
        return res.status(400).json({ message: "Manglende assessmentId" });
      }
      
      // Hent den eksisterende vurdering
      const assessment = await storage.getCareerAssessment(assessmentId);
      
      if (!assessment) {
        return res.status(404).json({ message: "Karrierevurdering ikke fundet" });
      }
      
      // Opdater status til 'saved_to_profile'
      let updatedAssessment = await storage.updateCareerAssessmentStatus(
        assessmentId, 
        'saved_to_profile'
      );
      // Hvis opdateringen fejler, brug den oprindelige vurdering
      if (!updatedAssessment) {
        updatedAssessment = assessment;
      }
      
      res.status(200).json({ 
        success: true, 
        message: "Karrierevurdering gemt i profil",
        assessment: updatedAssessment || assessment 
      });
    } catch (error) {
      console.error("Fejl ved gemming af karrierevurdering i profil:", error);
      res.status(500).json({ message: "Der opstod en fejl ved gemming af karrierevurdering i profil" });
    }
  });

  // Endpoint til at analysere en karrierevurdering med AI
  app.post("/api/career-assessment/:id/analyze", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const assessment = await storage.getCareerAssessment(id);
      
      if (!assessment) {
        return res.status(404).json({ message: "Karrierevurdering ikke fundet" });
      }
      
      // Brug OpenAI til at analysere svarene
      const result = await analyzeWithAI({
        analyzeType: 'career-assessment',
        assessmentAnswers: assessment.answers
      });
      
      // Parse resultatet som JSON (hvis det er en gyldig JSON-streng)
      let parsedResult;
      try {
        parsedResult = JSON.parse(result);
      } catch (e) {
        parsedResult = { error: "Kunne ikke analysere resultat", rawResult: result };
      }
      
      // Gem resultatet i databasen
      let updatedAssessment = await storage.updateCareerAssessmentResult(id, parsedResult);
      
      if (!updatedAssessment) {
        // Hvis opdateringen fejler, brug den oprindelige vurdering med manuelt tilføjet resultat
        updatedAssessment = {
          ...assessment,
          result: JSON.stringify(parsedResult)
        };
        console.warn("Kunne ikke opdatere vurderingsresultat i databasen, bruger lokalt opdateret objekt");
      }
      
      res.json(updatedAssessment);
    } catch (error) {
      res.status(500).json({ message: "Der opstod en fejl ved analysen" });
    }
  });

  // Skills identification endpoints
  app.post("/api/skills", async (req: Request, res: Response) => {
    try {
      console.log("Modtog anmodning til /api/skills med data:", JSON.stringify(req.body));
      
      // Validér data
      const validatedData = insertSkillSchema.parse(req.body);
      
      // Håndter data med både udvalgte og kategoriserede kompetencer
      const data = validatedData as any; // Typecasting for at håndtere de ekstra felter
      
      // Hvis vi har kategoriserede kompetencer, konverter dem til JSON
      if (data.categorizedSkills) {
        console.log("Modtog kategoriserede kompetencer:", JSON.stringify(data.categorizedSkills));
        
        // Kombinér og gem både kategoriserede kompetencer og almindelige arrays
        validatedData.skillList = JSON.stringify({
          selectedSkills: Array.isArray(data.selectedSkills) ? data.selectedSkills : [data.selectedSkills],
          customSkills: Array.isArray(data.customSkills) ? data.customSkills : [data.customSkills],
          categorizedSkills: data.categorizedSkills
        });
      }
      // Hvis vi ikke har kategoriserede kompetencer, brug det gamle format
      else if (data.selectedSkills || data.customSkills) {
        const selectedSkills = data.selectedSkills || [];
        const customSkills = data.customSkills || [];
        
        // Kombinér og konvertér til JSON-streng (bagudkompatibilitet)
        validatedData.skillList = JSON.stringify({
          selectedSkills: Array.isArray(selectedSkills) ? selectedSkills : [selectedSkills],
          customSkills: Array.isArray(customSkills) ? customSkills : [customSkills],
        });
      }
      
      // Tilføj titel hvis ikke angivet
      if (!validatedData.title) {
        validatedData.title = "Kompetencevurdering";
      }
      
      const skills = await storage.createSkills(validatedData);
      console.log("Kompetencer gemt med ID:", skills.id);
      res.status(201).json(skills);
    } catch (error) {
      console.error("Fejl ved oprettelse af kompetencer:", error);
      if (error instanceof z.ZodError) {
        console.error("Zod valideringsfejl:", JSON.stringify(error.errors));
        res.status(400).json({ message: "Ugyldig inputdata", errors: error.errors });
      } else {
        console.error("Andet fejl ved oprettelse af kompetencer:", error);
        res.status(500).json({ message: "Der opstod en fejl ved oprettelse af kompetencer" });
      }
    }
  });

  app.get("/api/skills/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const skills = await storage.getSkills(id);
      
      if (!skills) {
        return res.status(404).json({ message: "Kompetencer ikke fundet" });
      }
      
      res.json(skills);
    } catch (error) {
      res.status(500).json({ message: "Der opstod en fejl ved hentning af kompetencer" });
    }
  });

  // Job search strategy endpoints
  app.post("/api/job-search-strategy", async (req: Request, res: Response) => {
    try {
      const validatedData = insertJobSearchStrategySchema.parse(req.body);
      const strategy = await storage.createJobSearchStrategy(validatedData);
      res.status(201).json(strategy);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Ugyldig inputdata", errors: error.errors });
      } else {
        res.status(500).json({ message: "Der opstod en fejl ved oprettelse af jobsøgningsstrategi" });
      }
    }
  });

  app.get("/api/job-search-strategy/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const strategy = await storage.getJobSearchStrategy(id);
      
      if (!strategy) {
        return res.status(404).json({ message: "Jobsøgningsstrategi ikke fundet" });
      }
      
      res.json(strategy);
    } catch (error) {
      res.status(500).json({ message: "Der opstod en fejl ved hentning af jobsøgningsstrategi" });
    }
  });

  app.put("/api/job-search-strategy/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const strategyUpdate = req.body;
      
      const updatedStrategy = await storage.updateJobSearchStrategy(id, strategyUpdate);
      
      if (!updatedStrategy) {
        return res.status(404).json({ message: "Jobsøgningsstrategi ikke fundet" });
      }
      
      res.json(updatedStrategy);
    } catch (error) {
      res.status(500).json({ message: "Der opstod en fejl ved opdatering af jobsøgningsstrategi" });
    }
  });

  // Appointment booking endpoints
  app.post("/api/appointments", async (req: Request, res: Response) => {
    try {
      const validatedData = insertAppointmentSchema.parse(req.body);
      const appointment = await storage.createAppointment(validatedData);
      res.status(201).json(appointment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Ugyldig inputdata", errors: error.errors });
      } else {
        res.status(500).json({ message: "Der opstod en fejl ved oprettelse af aftale" });
      }
    }
  });

  app.get("/api/appointments", async (_req: Request, res: Response) => {
    try {
      const appointments = await storage.getAllAppointments();
      res.json(appointments);
    } catch (error) {
      res.status(500).json({ message: "Der opstod en fejl ved hentning af aftaler" });
    }
  });

  // Resume review endpoints
  app.post("/api/resume-review", async (req: Request, res: Response) => {
    try {
      const validatedData = insertResumeReviewSchema.parse(req.body);
      const review = await storage.createResumeReview(validatedData);
      res.status(201).json(review);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Ugyldig inputdata", errors: error.errors });
      } else {
        res.status(500).json({ message: "Der opstod en fejl ved oprettelse af CV-gennemgang" });
      }
    }
  });

  app.get("/api/resume-review/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const review = await storage.getResumeReview(id);
      
      if (!review) {
        return res.status(404).json({ message: "CV-gennemgang ikke fundet" });
      }
      
      res.json(review);
    } catch (error) {
      res.status(500).json({ message: "Der opstod en fejl ved hentning af CV-gennemgang" });
    }
  });

  app.put("/api/resume-review/:id/feedback", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { feedback } = req.body;
      
      if (!feedback) {
        return res.status(400).json({ message: "Feedback er påkrævet" });
      }
      
      const updatedReview = await storage.updateResumeReviewFeedback(id, feedback);
      
      if (!updatedReview) {
        return res.status(404).json({ message: "CV-gennemgang ikke fundet" });
      }
      
      res.json(updatedReview);
    } catch (error) {
      res.status(500).json({ message: "Der opstod en fejl ved opdatering af feedback" });
    }
  });

  // AI Analysis endpoints
  app.post("/api/ai/cv-optimization", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }

      const { userProfile, jobDescription, cvText } = req.body;

      if (!cvText) {
        return res.status(400).json({ message: "CV-tekst er påkrævet" });
      }

      const analysisOptions: AIAnalysisOptions = {
        userProfile,
        jobDescription,
        cvText,
        analyzeType: 'cv-optimization'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ analysis });
    } catch (error) {
      logAIError('cv-optimization', error instanceof Error ? error : new Error('Unknown error'), {
        userProfile: req.body.userProfile,
        hasJobDescription: !!req.body.jobDescription,
        hasCvText: !!req.body.cvText
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl under analysen", error: errorMessage });
    }
  });

  app.post("/api/ai/job-matching", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { userProfile, jobDescription, cvText } = req.body;

      if (!jobDescription) {
        return res.status(400).json({ message: "Jobopslag er påkrævet" });
      }

      const analysisOptions: AIAnalysisOptions = {
        userProfile,
        jobDescription,
        cvText,
        analyzeType: 'job-matching'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ analysis });
    } catch (error) {
      logAIError('job-matching', error instanceof Error ? error : new Error('Unknown error'), {
        userProfile: req.body.userProfile,
        hasJobDescription: !!req.body.jobDescription,
        hasCvText: !!req.body.cvText
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl under analysen", error: errorMessage });
    }
  });

  app.post("/api/ai/interview-prep", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { userProfile, jobDescription, interviewQuestion } = req.body;

      if (!interviewQuestion) {
        return res.status(400).json({ message: "Interviewspørgsmål er påkrævet" });
      }

      const analysisOptions: AIAnalysisOptions = {
        userProfile,
        jobDescription,
        interviewQuestion,
        analyzeType: 'interview-prep'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ analysis });
    } catch (error) {
      logAIError('interview-prep', error instanceof Error ? error : new Error('Unknown error'), {
        userProfile: req.body.userProfile,
        hasJobDescription: !!req.body.jobDescription,
        hasInterviewQuestion: !!req.body.interviewQuestion
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl under analysen", error: errorMessage });
    }
  });

  app.post("/api/ai/linkedin-optimization", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { 
        linkedInProfile, 
        targetRole, 
        skills, 
        experience, 
        customization,
        userProfile 
      } = req.body;

      if (!linkedInProfile) {
        return res.status(400).json({ message: "LinkedIn-profiltekst er påkrævet" });
      }

      const analysisOptions: AIAnalysisOptions = {
        userProfile,
        linkedInProfile,
        targetRole,
        skills,
        experience,
        customization,
        analyzeType: 'linkedin-optimization'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ analysis });
    } catch (error) {
      logAIError('linkedin-optimization', error instanceof Error ? error : new Error('Unknown error'), {
        userProfile: req.body.userProfile,
        hasLinkedInProfile: !!req.body.linkedInProfile,
        hasTargetRole: !!req.body.targetRole
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl under analysen", error: errorMessage });
    }
  });

  // Ny API-endepunkt til CV-bygger
  app.post("/api/ai/cv-builder", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { userProfile, workExperience, education, skills, jobDescription } = req.body;

      if (!workExperience) {
        return res.status(400).json({ message: "Arbejdserfaring er påkrævet" });
      }

      const analysisOptions: AIAnalysisOptions = {
        userProfile,
        workExperience,
        education,
        skills,
        jobDescription,
        analyzeType: 'cv-builder'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ analysis });
    } catch (error) {
      logAIError('cv-builder', error instanceof Error ? error : new Error('Unknown error'), {
        userProfile: req.body.userProfile,
        hasWorkExperience: !!req.body.workExperience,
        hasEducation: !!req.body.education,
        hasSkills: !!req.body.skills
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl under CV-generering", error: errorMessage });
    }
  });

  // Ny API-endepunkt til ansøgningsgenerator
  app.post("/api/ai/application-builder", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { userProfile, workExperience, education, skills, jobDescription, cvText } = req.body;

      if (!jobDescription) {
        return res.status(400).json({ message: "Jobopslag er påkrævet" });
      }

      const analysisOptions: AIAnalysisOptions = {
        userProfile,
        workExperience,
        education,
        skills,
        jobDescription,
        cvText,
        analyzeType: 'application-builder'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ analysis });
    } catch (error) {
      logAIError('application-builder', error instanceof Error ? error : new Error('Unknown error'), {
        userProfile: req.body.userProfile,
        hasJobDescription: !!req.body.jobDescription,
        hasCvText: !!req.body.cvText,
        hasWorkExperience: !!req.body.workExperience
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl under ansøgningsgenerering", error: errorMessage });
    }
  });

  // Ny API-endepunkt til jobaøgning
  app.post("/api/ai/job-search", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { userProfile, workExperience, education, skills, jobSearchQuery } = req.body;

      if (!userProfile && !workExperience && !skills) {
        return res.status(400).json({ message: "Mindst én af følgende er påkrævet: profil, arbejdserfaring eller færdigheder" });
      }

      const analysisOptions: AIAnalysisOptions = {
        userProfile,
        workExperience,
        education,
        skills,
        jobSearchQuery,
        analyzeType: 'job-search'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ analysis });
    } catch (error) {
      logAIError('job-search', error instanceof Error ? error : new Error('Unknown error'), {
        userProfile: req.body.userProfile,
        hasJobSearchQuery: !!req.body.jobSearchQuery,
        hasWorkExperience: !!req.body.workExperience,
        hasSkills: !!req.body.skills
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl under jobsøgningsanalysen", error: errorMessage });
    }
  });

  // Ny API-endepunkt til interview-øvelse
  app.post("/api/ai/interview-practice", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { userProfile, jobDescription, interviewQuestion } = req.body;

      if (!jobDescription) {
        return res.status(400).json({ message: "Jobopslag er påkrævet" });
      }

      const analysisOptions: AIAnalysisOptions = {
        userProfile,
        jobDescription,
        interviewQuestion,
        analyzeType: 'interview-practice'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ analysis });
    } catch (error) {
      logAIError('interview-practice', error instanceof Error ? error : new Error('Unknown error'), {
        userProfile: req.body.userProfile,
        hasJobDescription: !!req.body.jobDescription,
        hasInterviewQuestion: !!req.body.interviewQuestion
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl under interviewsimulering", error: errorMessage });
    }
  });

  // Ny API-endepunkt til interview-rådgiver
  app.post("/api/ai/interview-advisor", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { jobDescription, interviewQuestion } = req.body;

      if (!interviewQuestion) {
        return res.status(400).json({ message: "Interviewspørgsmål er påkrævet" });
      }

      const analysisOptions: AIAnalysisOptions = {
        jobDescription,
        interviewQuestion,
        analyzeType: 'interview-advisor'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ analysis });
    } catch (error) {
      logAIError('interview-advisor', error instanceof Error ? error : new Error('Unknown error'), {
        hasJobDescription: !!req.body.jobDescription,
        hasInterviewQuestion: !!req.body.interviewQuestion
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl med interview-rådgiveren", error: errorMessage });
    }
  });

  // Smart CV Feedback System
  app.post("/api/ai/smart-cv-feedback", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { cvText, userProfile, jobDescription } = req.body;

      if (!cvText) {
        return res.status(400).json({ message: "CV-tekst er påkrævet" });
      }

      const analysisOptions: AIAnalysisOptions = {
        cvText,
        userProfile,
        jobDescription,
        analyzeType: 'smart-cv-feedback'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ feedback: analysis });
    } catch (error) {
      logAIError('smart-cv-feedback', error instanceof Error ? error : new Error('Unknown error'), {
        hasCvText: !!req.body.cvText,
        hasUserProfile: !!req.body.userProfile,
        hasJobDescription: !!req.body.jobDescription
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl under CV-feedback analyse", error: errorMessage });
    }
  });

  // Ny API-endepunkt til CV-oversættelse
  app.post("/api/ai/cv-translator", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { cvText, targetLanguage } = req.body;

      if (!cvText) {
        return res.status(400).json({ message: "CV-tekst er påkrævet" });
      }

      if (!targetLanguage) {
        return res.status(400).json({ message: "Målsprog er påkrævet" });
      }

      const analysisOptions: AIAnalysisOptions = {
        cvText,
        targetLanguage,
        analyzeType: 'cv-translator'
      };

      const analysis = await analyzeWithAI(analysisOptions);
      res.json({ analysis });
    } catch (error) {
      logAIError('cv-translator', error instanceof Error ? error : new Error('Unknown error'), {
        hasCvText: !!req.body.cvText,
        targetLanguage: req.body.targetLanguage
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Der opstod en fejl under CV-oversættelse", error: errorMessage });
    }
  });

  // Ny API-endepunkt til CV suggestions (wizard flow)
  app.post("/api/ai/cv-suggestion", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API-nøgle mangler. Kontakt venligst administratoren." });
      }
      
      const { type, context } = req.body;
      
      if (!type || !context) {
        return res.status(400).json({ message: "Type og kontekst er påkrævet." });
      }
      
      let prompt = '';
      
      switch (type) {
        case 'experience':
          prompt = `Generer forslag til erhvervserfaring for en person med stillingen "${context.position || 'generel stilling'}". 
          
          Returner resultatet som JSON:
          {
            "experiences": [
              {
                "id": "unique-id",
                "company": "Virksomhedsnavn",
                "position": "Stillingsbetegnelse",
                "startDate": "2020-01",
                "endDate": "2023-12",
                "description": "Detaljeret beskrivelse af ansvarsområder og resultater",
                "current": false
              }
            ]
          }
          
          Generer 1-2 relevante job-forslag med realistiske danske virksomhedsnavne og konkrete ansvarsområder.`;
          break;
          
        case 'experience-description':
          prompt = `Generer en professionel beskrivelse af arbejdsopgaver for stillingen "${context.position}" hos "${context.company}".
          
          Returner resultatet som JSON:
          {
            "description": "Detaljeret beskrivelse af ansvarsområder, resultater og kompetencer brugt i stillingen. Fokuser på konkrete resultater og anvendte færdigheder."
          }
          
          Beskrivelsen skal være 2-4 linjer, konkret og professionel.`;
          break;
          
        case 'skills':
          const experienceContext = context.experiences?.map(exp => `${exp.position} hos ${exp.company}`).join(', ') || 'generel erfaring';
          prompt = `Baseret på denne erhvervserfaring: "${experienceContext}", foreslå relevante kompetencer for et dansk CV.
          
          Returner resultatet som JSON:
          {
            "skills": [
              "Kompetence 1",
              "Kompetence 2",
              "Kompetence 3"
            ]
          }
          
          Generer 5-8 relevante kompetencer inden for både faglige færdigheder, IT-værktøjer og personlige egenskaber.`;
          break;
          
        case 'profile':
          const name = context.personalInfo?.name || 'Kandidaten';
          const experienceDesc = context.experiences?.map(exp => exp.position).join(', ') || 'forskellige stillinger';
          const skillsDesc = context.skills?.slice(0, 3).join(', ') || 'brede kompetencer';
          
          prompt = `Skriv en kort, professionel profiltekst for ${name} med erfaring inden for: ${experienceDesc} og kompetencer som: ${skillsDesc}.
          
          Returner resultatet som JSON:
          {
            "profileText": "2-3 sætninger der beskriver personens styrker, erfaring og karrieremål på en engagerende måde"
          }
          
          Profilteksten skal være mellem 100-200 ord, konkret og målrettet danske arbejdsgivere.`;
          break;
          
        default:
          return res.status(400).json({ message: `Ukendt suggestion type: ${type}` });
      }
      
      const analysisOptions: AIAnalysisOptions = {
        prompt: prompt,
        temperature: 0.7,
        maxTokens: 600,
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        responseFormat: "json_object"
      };
      
      const result = await analyzeWithAI(analysisOptions);
      
      // Parse JSON response with error handling
      try {
        const parsedResult = JSON.parse(result);
        res.json(parsedResult);
      } catch (parseError) {
        console.error('JSON parsing error:', parseError);
        console.error('Raw AI result:', result);
        // Fallback - return structured data based on type
        let fallbackResult = {};
        if (type === 'skills') {
          fallbackResult = { skills: ["Problemløsning", "Kommunikation", "Teamwork", "Analytisk tænkning", "Kreativitet"] };
        } else if (type === 'profile') {
          fallbackResult = { profileText: "Engageret og kompetent kandidat med bred erfaring og stærke faglige færdigheder." };
        } else if (type === 'experience') {
          fallbackResult = { suggestions: "Beskriv dine konkrete resultater og ansvar i stillingen." };
        }
        res.json(fallbackResult);
      }
      
    } catch (error) {
      logAIError('cv-suggestion', error instanceof Error ? error : new Error('Unknown error'), {
        type: req.body.type,
        hasContext: !!req.body.context
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Fejl ved generering af CV-forslag.", error: errorMessage });
    }
  });

  // CV Analysis endpoint for new CV builder
  app.post('/api/ai/cv-analysis', aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      const { cvData } = req.body;
      
      if (!cvData) {
        return res.status(400).json({ message: 'CV data er påkrævet' });
      }

      // Generer detaljeret analyse prompt
      const prompt = `Analyser dette CV og giv en detaljeret optimering. CV data:

Personlige oplysninger:
- Navn: ${cvData.personalInfo?.name || 'Ikke angivet'}
- Email: ${cvData.personalInfo?.email || 'Ikke angivet'}
- Telefon: ${cvData.personalInfo?.phone || 'Ikke angivet'}
- Lokation: ${cvData.personalInfo?.location || 'Ikke angivet'}

Arbejdserfaring:
${cvData.experiences?.map((exp: any) => `
- ${exp.title || exp.position} hos ${exp.company} (${exp.startDate} - ${exp.endDate})
  Beskrivelse: ${exp.description || 'Ingen beskrivelse'}
`).join('') || 'Ingen arbejdserfaring angivet'}

Uddannelse:
${cvData.education?.map((edu: any) => `
- ${edu.degree} fra ${edu.school || edu.institution} (${edu.startDate} - ${edu.endDate})
  Beskrivelse: ${edu.description || 'Ingen beskrivelse'}
`).join('') || 'Ingen uddannelse angivet'}

Færdigheder:
${cvData.skills?.join(', ') || 'Ingen færdigheder angivet'}

Profiltekst:
${cvData.profileText || 'Ingen profiltekst angivet'}

Analyser dette CV og returner resultatet som JSON i følgende format:
{
  "overall_score": [score fra 0-100],
  "strengths": ["liste af styrker ved CV'et"],
  "improvements": ["liste af forbedringsområder"],
  "specific_suggestions": {
    "profile_text": "konkret feedback til profiltekst",
    "skills_to_add": ["færdigheder der bør tilføjes"],
    "skills_to_remove": ["færdigheder der bør fjernes eller erstattes"],
    "experience_improvements": [
      {
        "position": "stillingsnavn",
        "suggestion": "konkret forslag til forbedring af beskrivelsen"
      }
    ]
  },
  "optimized_profile": "optimeret version af profilteksten"
}

Fokuser på danske jobmarkedsstandarter, ATS-venlighed og moderne rekrutteringsforventninger. Giv konkrete, handlingsrettede forslag.`;

      // Direkte OpenAI API-kald for CV-analyse
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });

      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          {
            role: "system",
            content: "Du er en professionel CV-rådgiver. Analyser CV'et og returner resultatet som JSON i det angivne format. Svar kun med valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1200,
        response_format: { type: "json_object" }
      });

      const result = response.choices[0].message.content;
      
      // Parse JSON response with error handling
      try {
        const parsedResult = JSON.parse(result || '{}');
        
        // Validate required fields
        if (!parsedResult.overall_score || !parsedResult.strengths || !parsedResult.improvements) {
          throw new Error('Invalid JSON structure - missing required fields');
        }
        
        console.log('CV Analysis successful:', JSON.stringify(parsedResult, null, 2));
        res.json(parsedResult);
      } catch (parseError) {
        console.error('JSON parsing error in CV optimization:', parseError);
        console.error('Raw AI result:', result);
        
        // Intelligent fallback based on CV content
        const cvContent = JSON.stringify(req.body.cvData);
        const hasExperience = req.body.cvData.experiences && req.body.cvData.experiences.length > 0;
        const hasEducation = req.body.cvData.education && req.body.cvData.education.length > 0;
        const hasSkills = req.body.cvData.skills && req.body.cvData.skills.length > 0;
        const hasProfile = req.body.cvData.profileText && req.body.cvData.profileText.length > 50;
        
        // Dynamic scoring based on CV completeness
        let baseScore = 50;
        if (hasExperience) baseScore += 15;
        if (hasEducation) baseScore += 10;
        if (hasSkills) baseScore += 15;
        if (hasProfile) baseScore += 10;
        
        const fallbackResult = {
          overall_score: baseScore,
          strengths: [
            hasExperience ? "Solid arbejdserfaring der viser progression" : "Grundlæggende CV-struktur er på plads",
            hasSkills ? "Godt udvalg af relevante færdigheder" : "Kontaktoplysninger er komplette",
            hasProfile ? "Profiltekst giver et godt indtryk" : "Tydelig præsentation af uddannelse"
          ].filter(Boolean),
          improvements: [
            !hasProfile ? "Tilføj en overbevisende profiltekst" : "Gør profilteksten mere specifik",
            !hasExperience ? "Tilføj arbejdserfaring" : "Tilføj flere målbare resultater til arbejdserfaring",
            !hasSkills ? "Tilføj relevante færdigheder" : "Overvej at opdatere færdighedslisten",
            "Optimer CV'et til ATS-systemer"
          ].filter(Boolean),
          specific_suggestions: {
            profile_text: hasProfile ? "Gør profilteksten mere konkret med specifikke eksempler på dine resultater" : "Skriv en profiltekst der fremhæver dine hovedstyrker",
            skills_to_add: ["Projektledelse", "Dataanalyse", "Problemløsning", "Teamwork"],
            skills_to_remove: [],
            experience_improvements: hasExperience ? [
              {
                position: "Seneste stilling",
                suggestion: "Tilføj konkrete tal og resultater for at vise din påvirkning"
              }
            ] : [
              {
                position: "Generelt",
                suggestion: "Tilføj arbejdserfaring eller frivilligt arbejde"
              }
            ]
          },
          optimized_profile: hasProfile ? 
            "Erfaren professional med dokumenterede resultater inden for dit område. Specialiseret i at levere konkrete løsninger og drive positive forandringer." : 
            "Motiveret kandidat med solid uddannelsesbaggrund og stor lærelyst. Klar til at bidrage positivt til dit team."
        };
        
        console.log('Using intelligent fallback result:', JSON.stringify(fallbackResult, null, 2));
        res.json(fallbackResult);
      }
      
    } catch (error) {
      logAIError('cv-optimization', error instanceof Error ? error : new Error('Unknown error'), {
        hasCvData: !!req.body.cvData
      });
      const errorMessage = error instanceof Error ? error.message : 'Ukendt fejl';
      res.status(500).json({ message: "Fejl ved CV-optimering.", error: errorMessage });
    }
  });

  // Skabeloner endpoints
  app.get("/api/templates/:type/:id", (req: Request, res: Response) => {
    try {
      const { type, id } = req.params;
      
      // Validér type (cv eller application)
      if (type !== 'cv' && type !== 'application') {
        return res.status(400).json({ success: false, message: 'Ugyldig skabelontype' });
      }
      
      // Sikkerhedskontrol for at undgå directory traversal angreb
      const safeId = id.replace(/\.\./g, '').replace(/\//g, '');
      const filePath = path.join(process.cwd(), 'public', 'templates', type, safeId);
      
      console.log(`Forsøger at hente template fra: ${filePath}`);
      
      // Tjek om filen findes
      if (!fs.existsSync(filePath)) {
        console.error(`Template fil ikke fundet: ${filePath}`);
        return res.status(404).json({ success: false, message: 'Skabelon ikke fundet' });
      }
      
      // Send filen som download
      res.download(filePath, safeId, (err) => {
        if (err) {
          console.error(`Fejl ved download af fil: ${err.message}`);
          return res.status(500).json({ success: false, message: 'Kunne ikke downloade skabelonen' });
        }
      });
    } catch (error) {
      console.error('Error serving template file:', error);
      res.status(500).json({ success: false, message: 'Fejl ved hentning af skabelon' });
    }
  });
  
  // Registrer statiske filer
  // Ændret til en mere specifik sti for at undgå konflikter med frontend-routing
  app.use('/api/static/templates', express.static(path.join(process.cwd(), 'public', 'templates')));
  
  // Statisk rute for CV-skabeloner og deres assets
  app.use('/assets/cv-templates', express.static(path.join(process.cwd(), 'public', 'assets', 'cv-templates')));
  
  // Chatbot API endpoint
  app.post("/api/chat", aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      const { message, history, useRAG = false } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Besked er påkrævet" });
      }
      
      let reply;
      try {
        if (useRAG) {
          // Brug RAG-baseret svar hvis flag er sat
          console.log("Bruger RAG-baseret svar for forespørgsel:", message.substring(0, 50) + (message.length > 50 ? "..." : ""));
          reply = await generateRAGResponse(message, history || []);
          
          // Log brugerforespørgslen til fremtidig forbedring af RAG
          await logUserQuery(message, reply);
        } else {
          // Ellers brug almindelig chatbot svar
          reply = await getChatbotResponse(message, history || []);
        }
      } catch (error) {
        // Log fejlen og brug fallback
        logAIError('chatbot', error instanceof Error ? error : new Error('Unknown error'), {
          message: message.substring(0, 100),
          useRAG,
          historyLength: history?.length || 0
        });
        console.error("Fejl ved OpenAI kommunikation, bruger fallback svar:", error);
        
        // Speciel håndtering af almindelige API fejl
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("API key")) {
          console.warn("API-nøgle fejl detekteret, muligvis projekt-API-nøgle format problem");
        }
        
        // Brug altid fallback-svaret hvis OpenAI fejler uanset årsag
        reply = getFallbackResponse(message);
      }
      
      // Send svaret til brugeren
      res.json({ reply });
    } catch (error) {
      logAIError('chatbot-critical', error instanceof Error ? error : new Error('Unknown error'), {
        message: req.body.message?.substring(0, 100) || 'No message',
        useRAG: req.body.useRAG || false
      });
      console.error("Kritisk chatbot fejl:", error);
      // Forsøg at generere et fallback-svar selv i tilfælde af en kritisk fejl
      try {
        const fallbackReply = getFallbackResponse("generel") || "Beklager, der opstod en teknisk fejl. Prøv venligst igen senere.";
        res.json({ reply: fallbackReply });
      } catch (fallbackError) {
        // Hvis selv fallback fejler, send en enkel fejlmeddelelse
        res.status(500).json({ 
          error: "Der opstod en fejl ved behandling af din besked"
        });
      }
    }
  });
  
  // AI Experience Suggestions Endpoint for CV Builder
  app.post('/api/ai/experience-suggestions', aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      const { prompt, jobTitle, company, industry } = req.body;

      if (!prompt) {
        return res.status(400).json({ 
          success: false, 
          message: 'Prompt er påkrævet' 
        });
      }

      // Enhanced prompt for better Danish results
      const systemPrompt = `Du er en professionel karriererådgiver med speciale i danske arbejdsforhold. 
      Din opgave er at hjælpe med at skrive professionelle CV-beskrivelser og præstationer på dansk.
      
      Retningslinjer:
      - Brug professionelt dansk sprog
      - Fokuser på konkrete resultater og målbare præstationer
      - Brug aktive verber (implementerede, ledede, optimerede, etc.)
      - Tilpas til dansk arbejdskultur og forventninger
      - Vær præcis og relevant for branchen
      - Undgå overflødige ord og klichéer`;

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });

      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.7
      });

      const suggestion = response.choices[0].message.content?.trim();

      if (!suggestion) {
        throw new Error('Ingen AI-respons modtaget');
      }

      // If asking for achievements, try to split into multiple points
      if (prompt.toLowerCase().includes('præstation') || prompt.toLowerCase().includes('resultater')) {
        const achievements = suggestion.split('\n')
          .filter(line => line.trim())
          .map(line => line.replace(/^[•\-\*\d\.]\s*/, '').trim())
          .filter(line => line.length > 10);

        res.json({
          success: true,
          suggestion,
          achievements: achievements.slice(0, 4) // Max 4 achievements
        });
      } else {
        res.json({
          success: true,
          suggestion
        });
      }

    } catch (error: any) {
      logAIError('experience-suggestions', error instanceof Error ? error : new Error('Unknown error'), {
        jobTitle, company, industry
      });
      
      let errorMessage = 'Fejl ved AI-generering.';
      
      if (error.message?.includes('API key')) {
        errorMessage = 'AI-tjenesten er ikke tilgængelig.';
      } else if (error.message?.includes('rate limit')) {
        errorMessage = 'For mange forespørgsler. Prøv igen om lidt.';
      }

      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }
  });

  // AI Education Suggestions Endpoint for CV Builder
  app.post('/api/ai/education-suggestions', aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      const { prompt, degree, school, field, type, industry } = req.body;

      if (!prompt) {
        return res.status(400).json({ 
          success: false, 
          message: 'Prompt er påkrævet' 
        });
      }

      const systemPrompt = `Du er en professionel karriererådgiver med speciale i danske uddannelsesforhold. 
      Din opgave er at hjælpe med at skrive relevante og professionelle uddannelsesbeskrivelser på dansk.
      
      Retningslinjer:
      - Brug professionelt dansk sprog
      - Fokuser på praktiske færdigheder og relevante fagområder
      - Fremhæv hvad der er særligt værdifuldt for arbejdsgivere
      - Tilpas til dansk uddannelseskultur og jobmarked
      - Vær konkret og undgå akademisk jargon
      - Fremhæv projektarbejde, specialer og praktiske erfaringer`;

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });

      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        max_tokens: 200,
        temperature: 0.6
      });

      const suggestion = response.choices[0].message.content?.trim();

      if (!suggestion) {
        throw new Error('Ingen AI-respons modtaget');
      }

      res.json({
        success: true,
        suggestion
      });

    } catch (error: any) {
      logAIError('education-suggestions', error instanceof Error ? error : new Error('Unknown error'), {
        degree, school, field, type, industry
      });
      
      let errorMessage = 'Fejl ved AI-generering.';
      
      if (error.message?.includes('API key')) {
        errorMessage = 'AI-tjenesten er ikke tilgængelig.';
      } else if (error.message?.includes('rate limit')) {
        errorMessage = 'For mange forespørgsler. Prøv igen om lidt.';
      }

      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }
  });

  // AI Skills Suggestions Endpoint for CV Builder
  app.post('/api/ai/skills-suggestions', aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      const { prompt, category, industry, existingSkills } = req.body;

      if (!prompt) {
        return res.status(400).json({ 
          success: false, 
          message: 'Prompt er påkrævet' 
        });
      }

      const systemPrompt = `Du er en professionel karriererådgiver med ekspertise i danske jobkrav og færdigheder. 
      Din opgave er at foreslå relevante, moderne færdigheder som er efterspurgte på det danske jobmarked.
      
      Retningslinjer:
      - Foreslå kun færdigheder der er relevante og moderne
      - Tilpas til dansk arbejdsmarked og terminologi
      - Vær specifik og undgå generiske termer
      - Fokuser på færdigheder som faktisk efterspørges
      - Returner kun færdighederne som en kommasepareret liste
      - Ingen numre, bullets eller anden formatering`;

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });

      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        max_tokens: 150,
        temperature: 0.4
      });

      const suggestion = response.choices[0].message.content?.trim();

      if (!suggestion) {
        throw new Error('Ingen AI-respons modtaget');
      }

      res.json({
        success: true,
        suggestion
      });

    } catch (error: any) {
      logAIError('skills-suggestions', error instanceof Error ? error : new Error('Unknown error'), {
        category, industry, hasExistingSkills: !!existingSkills
      });
      
      let errorMessage = 'Fejl ved AI-generering.';
      
      if (error.message?.includes('API key')) {
        errorMessage = 'AI-tjenesten er ikke tilgængelig.';
      } else if (error.message?.includes('rate limit')) {
        errorMessage = 'For mange forespørgsler. Prøv igen om lidt.';
      }

      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }

  app.get('/api/download-cv-template/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const safeId = id.replace(/\.\./g, '').replace(/\//g, '');
      const filePath = path.join(process.cwd(), 'public', 'templates', 'cv', safeId);
      
      console.log(`Forsøger at downloade CV-skabelon fra: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        console.error(`CV-skabelon ikke fundet: ${filePath}`);
        return res.status(404).send('CV-skabelon ikke fundet');
      }
      
      res.download(filePath, safeId, (err) => {
        if (err) {
          console.error(`Fejl ved download af CV-skabelon: ${err.message}`);
          return res.status(500).send('Kunne ikke downloade CV-skabelonen');
        }
      });
    } catch (error) {
      console.error('Fejl ved servering af CV-skabelon:', error);
      res.status(500).send('Der opstod en fejl ved hentning af CV-skabelonen');
    }
  });
  
  // Download Word-skabeloner - ændret sti til at undgå frontend route konflikter
  app.get('/api/download-word-template/:filename', (req: Request, res: Response) => {
    try {
      const { filename } = req.params;
      
      // Sikkerhedskontrol for at undgå directory traversal angreb
      const safeFilename = filename.replace(/\.\./g, '').replace(/\//g, '');
      
      // Tjek om filnavnet er et .docx-dokument
      if (!safeFilename.endsWith('.docx')) {
        return res.status(400).send('Ugyldig filtype. Kun Word-dokumenter (.docx) er tilladt');
      }
      
      const filePath = path.join(process.cwd(), 'public', 'templates', 'word', safeFilename);
      
      console.log(`Forsøger at downloade Word-skabelon fra: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        console.error(`Word-skabelon ikke fundet: ${filePath}`);
        return res.status(404).send('Word-skabelon ikke fundet');
      }
      
      // Tilføj korrekt content type for Word-filer
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      
      res.download(filePath, safeFilename, (err) => {
        if (err) {
          console.error(`Fejl ved download af Word-skabelon: ${err.message}`);
          return res.status(500).send('Kunne ikke downloade Word-skabelonen');
        }
      });
    } catch (error) {
      console.error('Fejl ved download af Word-skabelon:', error);
      res.status(500).send('Der opstod en fejl ved download af Word-skabelonen');
    }
  });

  // Ressource-bibliotek endpoints
  app.get('/api/resources', async (_req: Request, res: Response) => {
    try {
      const resources = await storage.getAllResources();
      res.json(resources);
    } catch (error) {
      console.error('Fejl ved hentning af ressourcer:', error);
      res.status(500).json({ message: 'Kunne ikke hente ressourcer' });
    }
  });

  app.get('/api/resources/category/:category', async (req: Request, res: Response) => {
    try {
      const { category } = req.params;
      const resources = await storage.getResourcesByCategory(category);
      res.json(resources);
    } catch (error) {
      console.error('Fejl ved hentning af ressourcer efter kategori:', error);
      res.status(500).json({ message: 'Kunne ikke hente ressourcer efter kategori' });
    }
  });
  
  app.get('/api/resources/type/:type', async (req: Request, res: Response) => {
    try {
      const { type } = req.params;
      const resources = await storage.getResourcesByType(type);
      res.json(resources);
    } catch (error) {
      console.error('Fejl ved hentning af ressourcer efter type:', error);
      res.status(500).json({ message: 'Kunne ikke hente ressourcer efter type' });
    }
  });
  
  app.get('/api/resources/type/:type/category/:category', async (req: Request, res: Response) => {
    try {
      const { type, category } = req.params;
      const resources = await storage.getResourcesByTypeAndCategory(type, category);
      res.json(resources);
    } catch (error) {
      console.error('Fejl ved hentning af ressourcer efter type og kategori:', error);
      res.status(500).json({ message: 'Kunne ikke hente ressourcer efter type og kategori' });
    }
  });
  
  app.get('/api/resources/premium', async (_req: Request, res: Response) => {
    try {
      const resources = await storage.getPremiumResources();
      res.json(resources);
    } catch (error) {
      console.error('Fejl ved hentning af premium ressourcer:', error);
      res.status(500).json({ message: 'Kunne ikke hente premium ressourcer' });
    }
  });

  app.get('/api/resources/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const resource = await storage.getResource(id);
      
      if (!resource) {
        return res.status(404).json({ message: 'Ressource ikke fundet' });
      }
      
      res.json(resource);
    } catch (error) {
      console.error('Fejl ved hentning af ressource:', error);
      res.status(500).json({ message: 'Kunne ikke hente ressource' });
    }
  });
  
  // CV-skabelon endpoints
  app.get('/api/cv-templates', async (_req: Request, res: Response) => {
    try {
      // Hent alle CV-skabeloner
      const cvTemplateService = await import('./services/cvTemplateService');
      const templates = await cvTemplateService.getAllCVTemplates();
      
      res.json(templates);
    } catch (error) {
      console.error('Fejl ved hentning af CV-skabeloner:', error);
      res.status(500).json({ message: 'Kunne ikke hente CV-skabeloner' });
    }
  });
  
  app.get('/api/cv-templates/:id', async (req: Request, res: Response) => {
    try {
      const templateId = req.params.id;
      
      // Hent en skabelon baseret på ID
      const cvTemplateService = await import('./services/cvTemplateService');
      const template = await cvTemplateService.getCVTemplateById(templateId);
      
      if (template) {
        return res.json(template);
      }
      
      // Hvis ingen skabelon blev fundet
      return res.status(404).json({ message: 'CV-skabelon ikke fundet' });
    } catch (error) {
      console.error('Fejl ved hentning af CV-skabelon:', error);
      res.status(500).json({ message: 'Kunne ikke hente CV-skabelon' });
    }
  });
  
  app.get('/api/cv-templates/style/:style', async (req: Request, res: Response) => {
    try {
      const style = req.params.style;
      
      // Hent skabeloner baseret på stil
      const cvTemplateService = await import('./services/cvTemplateService');
      const templates = await cvTemplateService.getCVTemplatesByStyle(style);
      
      res.json(templates);
    } catch (error) {
      console.error('Fejl ved hentning af CV-skabeloner efter stil:', error);
      res.status(500).json({ message: 'Kunne ikke hente CV-skabeloner efter stil' });
    }
  });
  
  app.get('/api/cv-templates/popular', async (_req: Request, res: Response) => {
    try {
      // Hent populære CV-skabeloner
      const cvTemplateService = await import('./services/cvTemplateService');
      const templates = await cvTemplateService.getPopularCVTemplates();
      
      res.json(templates);
    } catch (error) {
      console.error('Fejl ved hentning af populære CV-skabeloner:', error);
      res.status(500).json({ message: 'Kunne ikke hente populære CV-skabeloner' });
    }
  });

  // API-endpoints for ansøgningsskabeloner
  app.get('/api/application-templates', async (_req: Request, res: Response) => {
    try {
      const templates = await getAllApplicationTemplates();
      res.json(templates);
    } catch (error) {
      console.error('Fejl ved hentning af ansøgningsskabeloner:', error);
      res.status(500).json({ message: 'Kunne ikke hente ansøgningsskabeloner' });
    }
  });

  app.get('/api/application-templates/:id', async (req: Request, res: Response) => {
    try {
      const templateId = req.params.id;
      const template = await getApplicationTemplateById(templateId);
      
      if (template) {
        return res.json(template);
      }
      
      return res.status(404).json({ message: 'Ansøgningsskabelon ikke fundet' });
    } catch (error) {
      console.error('Fejl ved hentning af ansøgningsskabelon:', error);
      res.status(500).json({ message: 'Kunne ikke hente ansøgningsskabelon' });
    }
  });

  app.post('/api/resources', async (req: Request, res: Response) => {
    try {
      const resourceData = insertResourceSchema.parse(req.body);
      const resource = await storage.createResource(resourceData);
      res.status(201).json(resource);
    } catch (error) {
      console.error('Fejl ved oprettelse af ressource:', error);
      res.status(400).json({ message: 'Ugyldige ressourcedata' });
    }
  });

  app.put('/api/resources/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const resourceData = req.body;
      
      const updatedResource = await storage.updateResource(id, resourceData);
      
      if (!updatedResource) {
        return res.status(404).json({ message: 'Ressource ikke fundet' });
      }
      
      res.json(updatedResource);
    } catch (error) {
      console.error('Fejl ved opdatering af ressource:', error);
      res.status(400).json({ message: 'Ugyldige ressourcedata' });
    }
  });

  app.delete('/api/resources/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteResource(id);
      
      if (!success) {
        return res.status(404).json({ message: 'Ressource ikke fundet' });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error('Fejl ved sletning af ressource:', error);
      res.status(500).json({ message: 'Kunne ikke slette ressource' });
    }
  });

  // POST endpoint til at konvertere HTML til Word med html-docx-js
  app.post('/api/download-word-template', async (req: Request, res: Response) => {
    try {
      const { html, filename } = req.body;
      
      if (!html || !filename) {
        return res.status(400).json({ message: 'Manglende HTML eller filnavn' });
      }
      
      // Sørg for at temp-mappen findes
      if (!fs.existsSync(path.join(process.cwd(), 'temp'))) {
        fs.mkdirSync(path.join(process.cwd(), 'temp'), { recursive: true });
      }
      
      // Importér htmlDocx biblioteket (gøres lokalt her for at undgå problemer med forskellige import typer)
      const HTMLtoDOCX = require('html-docx-js');
      
      // Konverter HTML direkte til Word-dokument
      const docx = HTMLtoDOCX.asBlob(html);
      
      // Generer filnavn
      const docxFileName = `${filename}.docx`;
      
      // Sæt Content-Type header for Word-dokument
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${docxFileName}"`);
      
      // Send direkte til browser som blob/binary
      res.send(docx);
    } catch (error) {
      console.error('Fejl ved konvertering til Word:', error);
      res.status(500).json({ message: 'Kunne ikke konvertere til Word' });
    }
  });

  // Kontaktformular endpoint
  app.post('/api/contact', async (req: Request, res: Response) => {
    try {
      const validatedData = insertContactMessageSchema.parse(req.body);
      const contactMessage = await storage.createContactMessage(validatedData);
      res.status(201).json(contactMessage);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Ugyldig inputdata", errors: error.errors });
      } else {
        res.status(500).json({ message: "Der opstod en fejl ved afsendelse af kontaktbesked" });
      }
    }
  });
  
  app.get('/api/contact/messages', async (_req: Request, res: Response) => {
    try {
      const messages = await storage.getAllContactMessages();
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Der opstod en fejl ved hentning af kontaktbeskeder" });
    }
  });
  
  // SendGrid email afsendelse endpoint
  app.post('/api/send-email', async (req: Request, res: Response) => {
    try {
      const { name, email, subject, message } = req.body;
      
      // Validér input
      if (!name || !email || !message) {
        return res.status(400).json({ message: "Navn, email og besked er påkrævede felter" });
      }
      
      // Email-validering med regex
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Ugyldig email-adresse" });
      }
      
      // Formatér HTML indhold med pænt layout
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4a5568; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Ny henvendelse via kontaktformular</h2>
          <p><strong>Navn:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Emne:</strong> ${subject || 'Ingen emne angivet'}</p>
          <h3 style="color: #4a5568; margin-top: 20px;">Besked:</h3>
          <div style="background-color: #f7fafc; padding: 15px; border-radius: 5px; border-left: 4px solid #4299e1;">
            ${message.replace(/\n/g, '<br>')}
          </div>
          <p style="color: #718096; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
            Denne email er sendt via kontaktformularen på hjemmesiden.
          </p>
        </div>
      `;
      
      // Send email
      const success = await sendEmail({
        to: 'support@optimera.ai', // Support email-adresse
        from: 'noreply@optimera.ai', // Dette skal være en verificeret afsender i SendGrid
        subject: `Kontaktformular: ${subject || 'Ny besked fra ' + name}`,
        text: `Navn: ${name}\nEmail: ${email}\nEmne: ${subject || 'Ikke angivet'}\n\nBesked:\n${message}`,
        html: htmlContent
      });
      
      if (success) {
        // Gem også i databasen hvis det er ønsket
        try {
          await storage.createContactMessage({
            name,
            email,
            subject: subject || 'Kontaktformular henvendelse',
            message,
            category: 'website'
          });
        } catch (dbError) {
          console.warn('Besked sendt via email, men kunne ikke gemmes i databasen:', dbError);
        }
        
        res.status(200).json({ success: true, message: "Besked sendt!" });
      } else {
        throw new Error('Kunne ikke sende email');
      }
    } catch (error) {
      console.error('Fejl ved afsendelse af email:', error);
      res.status(500).json({ 
        success: false, 
        message: "Der opstod en fejl ved afsendelse af besked",
        error: error instanceof Error ? error.message : 'Ukendt fejl'
      });
    }
  });
  
  // =========== Karriere-Pulsen Feedback API-endpoints ===========
  
  // Hent alle feedbacks
  app.get('/api/feedbacks', async (req, res) => {
    try {
      const feedbacks = await storage.getAllFeedbacks();
      res.json(feedbacks);
    } catch (error) {
      console.error('Fejl ved hentning af feedbacks:', error);
      res.status(500).json({
        message: 'Der opstod en fejl ved hentning af feedbacks',
        error: error instanceof Error ? error.message : 'Ukendt fejl'
      });
    }
  });
  
  // Hent feedback efter ID
  app.get('/api/feedbacks/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const feedback = await storage.getFeedback(id);
      
      if (!feedback) {
        return res.status(404).json({ message: 'Feedback ikke fundet' });
      }
      
      res.json(feedback);
    } catch (error) {
      console.error('Fejl ved hentning af feedback:', error);
      res.status(500).json({
        message: 'Der opstod en fejl ved hentning af feedback',
        error: error instanceof Error ? error.message : 'Ukendt fejl'
      });
    }
  });
  
  // Hent feedback efter værktøjsnavn
  app.get('/api/feedbacks/tool/:toolName', async (req, res) => {
    try {
      const { toolName } = req.params;
      const feedbacks = await storage.getFeedbacksByToolName(toolName);
      res.json(feedbacks);
    } catch (error) {
      console.error('Fejl ved hentning af feedback for værktøj:', error);
      res.status(500).json({
        message: 'Der opstod en fejl ved hentning af feedback for værktøj',
        error: error instanceof Error ? error.message : 'Ukendt fejl'
      });
    }
  });
  
  // Beta feedback endpoint med email notifikation
  app.post('/api/beta-feedback', async (req: any, res) => {
    try {
      const feedbackData = {
        toolName: req.body.toolName || 'Beta Test',
        rating: req.body.rating,
        feedbackType: req.body.feedbackType || 'beta_test',
        category: req.body.category || 'beta_feedback',
        priority: req.body.priority || 'medium',
        positiveComment: req.body.positiveComment,
        improvementComment: req.body.improvementComment,
        featureRequest: req.body.featureRequest,
        notifyOnImplementation: req.body.notifyOnImplementation || false,
        userId: req.isAuthenticated && req.isAuthenticated() ? req.user?.id : null
      };

      // Gem feedback i database
      const feedback = await storage.createFeedback(feedbackData);
      
      // Send email til dig med feedback-detaljerne
      const emailSubject = `🔥 Beta Feedback - ${feedbackData.toolName}`;
      const emailContent = `
        <h2>Ny Beta Feedback Modtaget</h2>
        <p><strong>Tidspunkt:</strong> ${new Date().toLocaleString('da-DK')}</p>
        <p><strong>Side:</strong> ${req.body.page || 'Ukendt'}</p>
        <p><strong>Bedømmelse:</strong> ${feedback.rating ? `${feedback.rating}/5 stjerner` : 'Ingen bedømmelse'}</p>
        <p><strong>Kategori:</strong> ${feedback.category}</p>
        <p><strong>Prioritet:</strong> ${feedback.priority}</p>
        
        ${feedback.positiveComment ? `<p><strong>Positiv kommentar:</strong><br>${feedback.positiveComment}</p>` : ''}
        ${feedback.improvementComment ? `<p><strong>Forbedringsforslag:</strong><br>${feedback.improvementComment}</p>` : ''}
        ${feedback.featureRequest ? `<p><strong>Feature-anmodning:</strong><br>${feedback.featureRequest}</p>` : ''}
        
        <p><strong>Browser:</strong> ${req.body.userAgent || 'Ukendt'}</p>
        <p><strong>Feedback ID:</strong> ${feedback.id}</p>
        
        <hr>
        <p><small>Dette er en automatisk genereret email fra Karriere Kompasset Beta Test systemet.</small></p>
      `;

      // Log feedback til console (kan implementeres med anden email-service senere)
      console.log('📧 BETA FEEDBACK MODTAGET:');
      console.log('=' + '='.repeat(50));
      console.log(`📅 Tidspunkt: ${new Date().toLocaleString('da-DK')}`);
      console.log(`📍 Side: ${req.body.page || 'Ukendt'}`);
      console.log(`⭐ Bedømmelse: ${feedback.rating ? `${feedback.rating}/5 stjerner` : 'Ingen bedømmelse'}`);
      console.log(`📂 Kategori: ${feedback.category}`);
      console.log(`🔥 Prioritet: ${feedback.priority}`);
      if (feedback.positiveComment) console.log(`✅ Positiv kommentar: ${feedback.positiveComment}`);
      if (feedback.improvementComment) console.log(`💡 Forbedringsforslag: ${feedback.improvementComment}`);
      if (feedback.featureRequest) console.log(`🚀 Feature-anmodning: ${feedback.featureRequest}`);
      console.log(`🌐 Browser: ${req.body.userAgent || 'Ukendt'}`);
      console.log(`🆔 Feedback ID: ${feedback.id}`);
      console.log('=' + '='.repeat(50));

      res.status(201).json({ 
        success: true, 
        message: 'Beta feedback modtaget og gemt',
        feedbackId: feedback.id 
      });
    } catch (error) {
      console.error('Error creating beta feedback:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Fejl ved at gemme feedback' 
      });
    }
  });

  // Opret ny feedback
  app.post('/api/feedbacks', async (req: any, res) => {
    try {
      const feedbackData = insertFeedbackSchema.parse(req.body);
      
      // Tilføj bruger-id hvis brugeren er logget ind
      if (req.isAuthenticated && typeof req.isAuthenticated === 'function' && req.isAuthenticated()) {
        feedbackData.userId = req.user?.id;
      }
      
      const feedback = await storage.createFeedback(feedbackData);
      res.status(201).json(feedback);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: 'Validering fejlede',
          errors: error.format()
        });
      }
      
      console.error('Fejl ved oprettelse af feedback:', error);
      res.status(500).json({
        message: 'Der opstod en fejl ved oprettelse af feedback',
        error: error instanceof Error ? error.message : 'Ukendt fejl'
      });
    }
  });
  
  // Opdater feedback implementeringsstatus (admin)
  app.patch('/api/feedbacks/:id/implementation', async (req: any, res) => {
    try {
      // Tjek om brugeren er admin
      if (!(req.isAuthenticated && typeof req.isAuthenticated === 'function' && req.isAuthenticated() && req.user?.role === 'admin')) {
        return res.status(403).json({ message: 'Ikke tilstrækkelige rettigheder' });
      }
      
      const id = parseInt(req.params.id, 10);
      const { isImplemented } = req.body;
      
      if (typeof isImplemented !== 'boolean') {
        return res.status(400).json({ message: 'isImplemented skal være en boolean værdi' });
      }
      
      const updatedFeedback = await storage.updateFeedbackImplementationStatus(id, isImplemented);
      
      if (!updatedFeedback) {
        return res.status(404).json({ message: 'Feedback ikke fundet' });
      }
      
      res.json(updatedFeedback);
    } catch (error) {
      console.error('Fejl ved opdatering af feedback implementation status:', error);
      res.status(500).json({
        message: 'Der opstod en fejl ved opdatering af feedback implementation status',
        error: error instanceof Error ? error.message : 'Ukendt fejl'
      });
    }
  });

  // AI Profile Suggestions and Project Suggestions Endpoints
  app.post('/api/ai/profile-suggestions', aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      const { prompt, promptType, industry } = req.body;

      if (!prompt) {
        return res.status(400).json({ 
          success: false, 
          message: 'Prompt er påkrævet' 
        });
      }

      const systemPrompt = `Du er en professionel karriererådgiver og CV-ekspert med speciale i danske arbejdsmarkedsforhold. 
      Din opgave er at skrive personlige, engagerende og professionelle CV-profiltekster på dansk.
      
      Retningslinjer:
      - Brug professionelt dansk sprog
      - Vær personlig men professionel
      - Fremhæv værdiskabelse og resultater
      - Undgå klichéer og generiske formuleringer
      - Fokuser på unikke styrker og motivation
      - Tilpas til danske rekrutteringsstandarter`;

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });

      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.7
      });

      const suggestion = response.choices[0].message.content?.trim();

      if (!suggestion) {
        throw new Error('Ingen AI-respons modtaget');
      }

      res.json({
        success: true,
        suggestion
      });

    } catch (error: any) {
      logAIError('profile-suggestions', error instanceof Error ? error : new Error('Unknown error'), {
        promptType: promptType || 'unknown', 
        industry: industry || 'unknown'
      });
      
      let errorMessage = 'Fejl ved AI-generering.';
      
      if (error.message?.includes('API key')) {
        errorMessage = 'AI-tjenesten er ikke tilgængelig.';
      } else if (error.message?.includes('rate limit')) {
        errorMessage = 'For mange forespørgsler. Prøv igen om lidt.';
      }

      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }
  });

  app.post('/api/ai/project-suggestions', aiRateLimiter.middleware, async (req: Request, res: Response) => {
    try {
      const { prompt, projectName, projectType, technologies, industry } = req.body;

      if (!prompt) {
        return res.status(400).json({ 
          success: false, 
          message: 'Prompt er påkrævet' 
        });
      }

      const systemPrompt = `Du er en professionel karriererådgiver med ekspertise i projektbeskrivelser og resultater. 
      Din opgave er at hjælpe med at skrive overbevisende projektbeskrivelser og konkrete resultater på dansk.
      
      Retningslinjer:
      - Brug professionelt dansk sprog
      - Fokuser på konkrete, målbare resultater
      - Fremhæv tekniske løsninger og forretningsværdi
      - Inkluder brugererfaring og påvirkning
      - Brug tal og metrikker hvor muligt
      - Vær præcis og relevant for projekttypen`;

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });

      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        max_tokens: 250,
        temperature: 0.6
      });

      const suggestion = response.choices[0].message.content?.trim();

      if (!suggestion) {
        throw new Error('Ingen AI-respons modtaget');
      }

      res.json({
        success: true,
        suggestion
      });

    } catch (error: any) {
      logAIError('project-suggestions', error instanceof Error ? error : new Error('Unknown error'), {
        projectName: projectName || 'unknown', 
        projectType: projectType || 'unknown', 
        technologiesCount: technologies?.length || 0, 
        industry: industry || 'unknown'
      });
      
      let errorMessage = 'Fejl ved AI-generering.';
      
      if (error.message?.includes('API key')) {
        errorMessage = 'AI-tjenesten er ikke tilgængelig.';
      } else if (error.message?.includes('rate limit')) {
        errorMessage = 'For mange forespørgsler. Prøv igen om lidt.';
      }

      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }
  });

  // Application builder routes
  registerApplicationRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
})))))))))))))))))));
