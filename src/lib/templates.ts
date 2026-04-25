export type TemplateVars = {
  date: string;          // YYYY-MM-DD
  n: number;             // 1 or 2
  lang_suffix: string;   // " (Arabic)" / " (Dutch)" / " (English)"
  khatib: string;        // empty string if not set
  other_part_link: string;
};

export function applyTemplate(template: string, vars: TemplateVars): string {
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  // Conditional placeholder: drop the line if khatib is empty
  s = s.replaceAll('{khatib_line}', vars.khatib ? `\nKhatib: ${vars.khatib}` : '');
  return s;
}

export function langSuffix(lang: string): string {
  const map: Record<string, string> = {
    ar: ' (Arabic)',
    nl: ' (Dutch)',
    en: ' (English)',
  };
  return map[lang] ?? '';
}
