// Test fallback system direkte
const testCVData = {
  personalInfo: {
    name: "Test Bruger",
    email: "test@email.dk",
    phone: "12345678",
    location: "København"
  },
  experiences: [
    {
      title: "Softwareudvikler",
      company: "TechFirma",
      duration: "2020-2024",
      description: "Udvikling af webapplikationer med React og Node.js"
    }
  ],
  education: [
    {
      degree: "Kandidat i Datalogi",
      institution: "KU",
      year: "2020"
    }
  ],
  skills: ["JavaScript", "React", "Node.js"],
  profileText: "Erfaren softwareudvikler med passion for web-teknologier"
};

// Test intelligent fallback logic
const hasExperience = testCVData.experiences && testCVData.experiences.length > 0;
const hasEducation = testCVData.education && testCVData.education.length > 0;
const hasSkills = testCVData.skills && testCVData.skills.length > 0;
const hasProfile = testCVData.profileText && testCVData.profileText.length > 50;

// Dynamic scoring based on CV completeness
let baseScore = 50;
if (hasExperience) baseScore += 15;
if (hasEducation) baseScore += 10;
if (hasSkills) baseScore += 15;
if (hasProfile) baseScore += 10;

console.log('CV Analysis Test:');
console.log('Has Experience:', hasExperience);
console.log('Has Education:', hasEducation);
console.log('Has Skills:', hasSkills);
console.log('Has Profile:', hasProfile);
console.log('Final Score:', baseScore);

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

console.log('\nFallback Result:', JSON.stringify(fallbackResult, null, 2));