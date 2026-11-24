/**
 * The one way the chat card renderers build an element: a tag on the given document, an optional class and an optional text
 * (set as `textContent`, so typed text is never read as markup).
 * @param {Document} doc
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
