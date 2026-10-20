// Markdown files are bundled as text (see the `rules` entry in wrangler.jsonc).
declare module '*.md' {
  const text: string;
  export default text;
}
