/** Read-only code snippet with line numbers. No code is ever executed. */
export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const lines = code.replace(/\n$/, '').split('\n');
  return (
    <div>
      <pre
        className="codeblock"
        tabIndex={0}
        aria-label={`${language ? `${language} ` : ''}code, ${lines.length} lines`}
      >
        {lines.map((line, i) => (
          <span key={i} className="codeblock-line">
            <span className="codeblock-ln" aria-hidden="true">
              {i + 1}
            </span>
            <code>{line || ' '}</code>
          </span>
        ))}
      </pre>
      {language && <p className="t-meta mt-1.5 text-right">{language}</p>}
    </div>
  );
}
