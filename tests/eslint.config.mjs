// Seule règle : nom de variable ou de fonction inconnu (ex. une fonction renommée à moitié). Lancé avant publication.
import globals from 'globals';
export default [{
  files: ['**/*.js'],
  languageOptions: {
    ecmaVersion: 'latest', sourceType: 'script',
    globals: { ...globals.browser, ...globals.serviceworker, chrome: 'readonly', L: 'readonly', jspdf: 'readonly', PDFLib: 'readonly', JSZip: 'readonly' },
  },
  rules: { 'no-undef': 'error' },
}];
