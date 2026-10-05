/** @jsxImportSource react */

import './ViewSourceReality.css';

function highlightSourceLine(line: string) {
  if (line.trim().startsWith('<!--')) {
    return <span className="view-source-comment">{line}</span>;
  }

  const parts = line.split(/(<\/?[a-zA-Z][^>]*>)/g);

  return parts.map((part, index) => {
    if (!part.startsWith('<')) {
      return <span key={index}>{part}</span>;
    }

    const match = part.match(/^(<\/?)([a-zA-Z0-9-]+)(.*?)(\/?>)$/);

    if (!match) {
      return <span key={index}>{part}</span>;
    }

    const [, opening, tagName, attributes, closing] = match;
    const attributeParts = attributes.split(/("[^"]*"|'[^']*')/g);

    return (
      <span key={index}>
        <span className="view-source-punctuation">{opening}</span>
        <span className="view-source-tag">{tagName}</span>

        {attributeParts.map((attributePart, attributeIndex) => {
          if (
            attributePart.startsWith('"') ||
            attributePart.startsWith("'")
          ) {
            return (
              <span
                className="view-source-string"
                key={attributeIndex}
              >
                {attributePart}
              </span>
            );
          }

          return (
            <span
              className="view-source-attribute"
              key={attributeIndex}
            >
              {attributePart}
            </span>
          );
        })}

        <span className="view-source-punctuation">{closing}</span>
      </span>
    );
  });
}

const SOURCE_LINES = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <title>who touched this</title>',
  '  </head>',
  '  <body>',
  '    <main id="random">',
  '',
  '      <!-- contributor #000 was here -->',
  '',
  '      <section data-component="gravity-glitch">',
  '        conceptually, stability rarely lasts.',
  '      </section>',
  '',
  '      <section data-component="live-code-breakdown">',
  '        <!-- something is eating this -->',
  '      </section>',
  '',
  '      <section data-component="wrong-perspective">',
  '        <!-- geometry ? -->',
  '      </section>',
  '',
  '      <section data-component="view-master">',
  '        <!-- this probably should not be here but i like it -->',
  '      </section>',
  '',
  '      <!-- TODO: figure out why there are floating pokemon -->',
  '      <!-- please stop inspecting things -->',
  '',
  '    </main>',
  '  </body>',
  '</html>',
];

export default function ViewSourceReality() {
  return (
    <div
      className="view-source-reality"
      aria-label="Alternate source-code view of the random page"
    >
      <div className="view-source-bar">
        <span>view-source:whotouchedthis.website/random</span>
      </div>

      <pre className="view-source-code">
        <code>
          {SOURCE_LINES.map((line, index) => (
            <span
              className="view-source-line"
              key={`${index}-${line}`}
            >
              <span className="view-source-line-number">
                {index + 1}
              </span>

              <span className="view-source-line-content">
                {highlightSourceLine(line)}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}