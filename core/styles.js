/*
 * QCStyles — how captions look. Today there is one style, "plain": a
 * normal Premiere caption track styled in Properties → Track Style.
 *
 * Built so styled captions can be added later without reshaping the
 * panel. Each style says:
 *   kind      "captions" (a caption track) or "mogrt" (one motion graphics
 *             clip per caption on a video track; the host fills in the text)
 *   preview   how the live preview draws it, as plain CSS properties the
 *             UXP renderer supports (no shadow, transform or animation)
 *   mogrt     for kind "mogrt": the bundled template file, made in After
 *             Effects with its text exposed as "Source Text"
 */
window.QCStyles = (function () {
  const LIST = [
    {
      id: "plain",
      name: "Plain",
      kind: "captions",
      preview: {
        backgroundColor: "#000000",
        color: "#ffffff",
        fontSize: "13px",
        fontWeight: "400",
        padding: "3px 8px",
        borderRadius: "3px",
      },
    },
  ];

  function get(id) {
    for (let i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return LIST[0];
  }

  // Draws a style onto the preview caption element.
  function applyPreview(el, id) {
    const p = get(id).preview;
    for (const k in p) el.style[k] = p[k];
  }

  return { LIST: LIST, get: get, applyPreview: applyPreview };
})();
