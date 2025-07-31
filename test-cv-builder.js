// Test script til at validere CV-byggerens forskellige scenarier
const testCases = {
  // Test 1: Simpelt, kort CV (få styrker, flere forbedringer)
  simple: {
    personalInfo: {
      name: "Anna Nielsen",
      email: "anna@email.dk",
      phone: "12345678",
      location: "København"
    },
    experiences: [
      {
        title: "Butiksassistent",
        company: "Netto",
        duration: "2023-2024",
        description: "Ekspedition af kunder"
      }
    ],
    education: [
      {
        degree: "Gymnasial uddannelse",
        institution: "Ørestad Gymnasium",
        year: "2023"
      }
    ],
    skills: ["Kundeservice", "Teamwork"],
    profileText: "Jeg er motiveret."
  },

  // Test 2: Langt, stærkt CV (flere styrker, få forbedringer)
  strong: {
    personalInfo: {
      name: "Michael Andersen",
      email: "michael.andersen@email.dk",
      phone: "87654321",
      location: "Aarhus"
    },
    experiences: [
      {
        title: "Senior Software Developer",
        company: "TechCorp Denmark",
        duration: "2020-2024",
        description: "Ledte udvikling af microservices-arkitektur for e-handelsplatform der serverer 500.000+ daglige brugere. Reducerede responstid med 40% gennem optimering af database-queries og implementering af caching-strategier. Mentorede 5 junior udviklere og etablerede code review-processer der reducerede produktionsfejl med 60%."
      },
      {
        title: "Full Stack Developer",
        company: "StartupHub",
        duration: "2018-2020",
        description: "Byggede React-baserede frontends og Node.js backends for 3 succesfulde startup-produkter. Implementerede CI/CD pipelines der reducerede deployment-tid fra 2 timer til 15 minutter. Øgede test-coverage fra 30% til 85% gennem systematisk implementering af unit og integration tests."
      }
    ],
    education: [
      {
        degree: "Kandidat i Datalogi",
        institution: "Aarhus Universitet",
        year: "2018"
      },
      {
        degree: "Bachelor i Softwareudvikling",
        institution: "Aarhus Universitet",
        year: "2016"
      }
    ],
    skills: ["JavaScript", "React", "Node.js", "TypeScript", "Docker", "AWS", "PostgreSQL", "Redis", "Microservices", "Agile", "Scrum", "Mentoring", "Code Review", "CI/CD", "Test-Driven Development"],
    profileText: "Erfaren Senior Software Developer med 6+ års dokumenteret erfaring inden for full-stack udvikling og teamledelse. Specialiseret i at bygge skalerbare web-applikationer der håndterer høj trafik og komplekse forretningsprocesser. Har ledet tekniske projekter fra konceptualisering til deployment og har en stærk track record med at levere målbare resultater og øge team-produktivitet. Passioneret omkring clean code, best practices og kontinuerlig læring."
  },

  // Test 3: CV med fejl og mangler
  flawed: {
    personalInfo: {
      name: "Peter", // Mangler efternavn
      email: "invalidmail", // Ugyldig email
      phone: "123", // For kort telefon
      location: "" // Mangler location
    },
    experiences: [
      {
        title: "", // Mangler titel
        company: "Firma",
        duration: "2020",
        description: "Arbejdede med ting" // Meget vag beskrivelse
      }
    ],
    education: [],
    skills: ["Ting", "Stuff"], // Vage færdigheder
    profileText: "Jeg er god til ting og søger job." // Meget kort og vag
  }
};

// Test funktion til at køre alle test cases
async function runCVTests() {
  console.log("🚀 Starter CV-bygger test suite...\n");
  
  for (const [testName, testData] of Object.entries(testCases)) {
    console.log(`📋 Test: ${testName.toUpperCase()}`);
    console.log("Data:", JSON.stringify(testData, null, 2));
    
    try {
      const response = await fetch('/api/ai/cv-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cvData: testData })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      console.log(`✅ Score: ${result.overall_score}/100`);
      console.log(`💪 Styrker (${result.strengths.length}):`, result.strengths);
      console.log(`🔧 Forbedringer (${result.improvements.length}):`, result.improvements);
      
      if (result.optimized_profile) {
        console.log(`📝 Optimeret profiltekst: ${result.optimized_profile.substring(0, 100)}...`);
      }
      
      console.log("---\n");
      
    } catch (error) {
      console.error(`❌ Test ${testName} fejlede:`, error.message);
      console.log("---\n");
    }
  }
  
  console.log("✨ Test suite afsluttet!");
}

// Eksporter test funktioner
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { testCases, runCVTests };
}