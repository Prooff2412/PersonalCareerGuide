export interface CVTemplate {
  id: number;
  name: string;
  description: string;
}

const templates: CVTemplate[] = [
  { id: 1, name: 'Klassisk', description: 'En klassisk og professionel CV-skabelon.' },
  { id: 2, name: 'Moderne', description: 'En moderne skabelon med fokus på design.' },
  { id: 3, name: 'Kreativ', description: 'En kreativ skabelon til kreative roller.' },
  { id: 4, name: 'Minimalistisk', description: 'En enkel skabelon med fokus på indhold.' }
];

export function getTemplates(): CVTemplate[] {
  return templates;
}

export function generateCV(): string {
  return 'CV generation is not implemented yet.';
}
