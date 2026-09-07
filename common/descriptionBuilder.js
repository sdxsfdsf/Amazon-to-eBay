/* Single source of truth for every Description output (copy + prompt + fill). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AEB = root.AEB || {};
  root.AEB.description = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /** Structured rows that must be treated as invisible (case/punctuation insensitive). */
  const EXCLUDED_LABELS = ["brand", "brand name", "manufacturer", "manufacturer name", "asin"];

  function normalizeLabel(label) {
    return String(label ?? "")
      .replace(/[\u200e\u200f\u00a0]/g, " ")
      .replace(/[:\u2236]+/g, " ")
      .replace(/[.,;*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isExcludedLabel(label) {
    return EXCLUDED_LABELS.includes(normalizeLabel(label));
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cleanLabel(label) {
    return String(label ?? "")
      .replace(/[\u200e\u200f]/g, "")
      .replace(/[:\s]+$/, "")
      .trim();
  }

  function filterAttributes(attributes) {
    return (attributes || [])
      .filter((a) => a && cleanLabel(a.label) && String(a.value ?? "").trim())
      .filter((a) => !isExcludedLabel(a.label));
  }

  /* ------------------------------------------------------------------ *
   * DESCRIPTION-ONLY structured-attribute blocklist.
   *
   * Applies to the rendered Product Details table of the Description
   * (Copy Description + eBay Description fill). It is intentionally SEPARATE
   * from EXCLUDED_LABELS / filterAttributes above, which are shared with the
   * Prompt path — Prompt output is unchanged.
   *
   * Matching is case-insensitive and CONTAINS-based on the FIELD LABEL only.
   * Values are never inspected, and About This Item bullet prose is never
   * touched, so a normal sentence mentioning a brand or a warranty survives.
   * ------------------------------------------------------------------ */
  const BLOCKED_DETAIL_TERMS = [
    "brand",
    "brand name",
    "manufacturer",
    "manufacturer name",
    "asin",
    "warranty",
    "guarantee",
  ];

  /** True when the LABEL contains any blocked term (case-insensitive). */
  function isBlockedDetailLabel(label) {
    const norm = normalizeLabel(label);
    if (!norm) return false;
    return BLOCKED_DETAIL_TERMS.some((term) => norm.includes(term));
  }

  const WEBSITE_OR_CONTACT_NAME =
    /\b(?:amazon|ebay|walmart|etsy|google|facebook|instagram|youtube|tiktok|twitter|pinterest|linkedin|reddit|aliexpress|temu|shopify|whatsapp|telegram|snapchat|discord|gmail|outlook|hotmail|yahoo|website|web\s*site|homepage|url|e-?mail|business\s*mail|mail\s*us|contact\s*us)\b/i;
  const DOMAIN_OR_URL =
    /(?:\b(?:https?|hxxps?|ftp):\/\/|\bmailto:|\bwww\d*\.|(?:^|[^@\w])(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+(?:com|net|org|co|io|ai|app|biz|info|me|us|uk|ca|de|fr|au|store|shop|online|site|website|xyz|link|ly)(?:\b|[\/:?#]))/i;
  const EMAIL_ADDRESS = /\b[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i;

  function normalizedContactText(value) {
    return String(value ?? "")
      .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
      .replace(/[＠﹫]/g, "@")
      .replace(/[．。｡]/g, ".")
      .replace(/(?:\[|\(|\{|<)\s*\.\s*(?:\]|\)|\}|>)/g, ".")
      .replace(/(?:\[|\(|\{)\s*dot\s*(?:\]|\)|\})|\bdot\b/gi, ".")
      .replace(/(?:\[|\(|\{)\s*at\s*(?:\]|\)|\})|\bat\b/gi, "@")
      .replace(/&#0*64;|&commat;/gi, "@")
      .replace(/&#0*46;|&period;/gi, ".")
      .replace(/\s*([@.])\s*/g, "$1");
  }

  /** Conservative eBay-description safety gate for contact details and external destinations. */
  function containsWebsiteOrEmail(value) {
    const text = normalizedContactText(value);
    const compact = text.replace(/\s+/g, "");
    return (
      WEBSITE_OR_CONTACT_NAME.test(text) ||
      DOMAIN_OR_URL.test(text) ||
      EMAIL_ADDRESS.test(text) ||
      DOMAIN_OR_URL.test(compact) ||
      EMAIL_ADDRESS.test(compact)
    );
  }

  /**
   * Product Details rows for the Description: the shared filter, plus the
   * blocklist. A blocked row is dropped whole — label AND value — so no empty
   * row is ever rendered.
   */
  function filterDescriptionAttributes(attributes) {
    return filterAttributes(attributes).filter(
      (a) =>
        !isBlockedDetailLabel(a.label) &&
        !containsWebsiteOrEmail(a.label) &&
        !containsWebsiteOrEmail(a.value),
    );
  }

  function filterDescriptionBullets(bullets) {
    return (bullets || []).filter((bullet) => {
      const text = String(bullet || "").trim();
      return text && !containsWebsiteOrEmail(text);
    });
  }

  function filterDescriptionStandaloneText(value) {
    const text = String(value || "").trim();
    return text && !containsWebsiteOrEmail(text) ? text : "";
  }

  const F = {
    title: "font-family:Arial,sans-serif;font-size:14px;font-weight:400;",
    label: "font-family:Arial,sans-serif;font-size:14px;font-weight:700;",
    value: "font-family:Arial,sans-serif;font-size:14px;font-weight:400;",
    heading: "font-family:Arial,sans-serif;font-size:24px;font-weight:700;",
    bullet: "font-family:Arial,sans-serif;font-size:14px;font-weight:400;",
  };

  /** Markdown table: first row, separator, remaining rows (matches the approved layout). */
  function attributesTable(attributes) {
    if (!attributes.length) return "";
    const labels = attributes.map((a) => `**${cleanLabel(a.label)}**`);
    const values = attributes.map((a) => String(a.value).trim());
    const lw = Math.max(...labels.map((l) => l.length));
    const vw = Math.max(...values.map((v) => v.length));
    const row = (i) => `| ${labels[i].padEnd(lw)} | ${values[i].padEnd(vw)} |`;
    const sep = `| ${"-".repeat(lw)} | ${"-".repeat(vw)} |`;
    const out = [row(0), sep];
    for (let i = 1; i < attributes.length; i += 1) out.push(row(i));
    return out.join("\n");
  }

  /** PROMPT ONLY: compact blank marker, then one plain `Field: Value` per line. */
  function buildPromptAttributesTable(attributes) {
    const rows = filterAttributes(attributes);
    if (!rows.length) return "";
    const fields = rows.map((a) => `${cleanLabel(a.label)}: ${String(a.value).trim()}`);
    return `|   |\n| - |\n\n${fields.join("\n")}`;
  }

  /** Normalized Description body (no Title) used by Copy Description, Copy Title & Description and Prompt. */
  function buildDescriptionPlainText(descriptionData, options) {
    const opts = options || {};
    const data = descriptionData || {};
    // Description output: blocked Product Details labels are removed here.
    const attributes = filterDescriptionAttributes(data.attributes);
    const bullets = filterDescriptionBullets(data.bullets);
    const blocks = [];
    const table = opts.promptFormat ? buildPromptAttributesTable(attributes) : attributesTable(attributes);
    if (table) blocks.push(table);
    if (bullets.length) {
      const heading = data.heading || "About this item";
      const gap = opts.promptFormat ? "\n\n" : "\n";
      blocks.push(`## ${heading}${gap}${bullets.map((b) => `- ${String(b).trim()}`).join("\n")}`);
    }
    const standaloneText = filterDescriptionStandaloneText(data.standaloneText);
    if (standaloneText) blocks.push(standaloneText);
    if (table && blocks.length > 1) return [blocks[0], "---", ...blocks.slice(1)].join("\n\n");
    return blocks.join("\n\n").trim();
  }

  function buildTitleAndDescriptionPlainText(title, descriptionData, options) {
    return `Title: ${title || ""}\n\n${buildDescriptionPlainText(descriptionData, options)}`.trim();
  }


  /* ------------------------------------------------------------------ *
   * DESCRIPTION TEMPLATE
   *
   * Port of the user-supplied responsive HTML template (flex-wrap based,
   * no image section). Every declaration lives ONLY inline — there is no
   * <style> block and no CSS classes carrying any styling at all, matching
   * the reference exactly. That's a deliberate simplification over the
   * previous table+<style> design, not just a stylistic choice: with
   * nothing but inline `style=""` attributes, there is no separate
   * stylesheet for eBay's own re-serialization to ever strip, so the
   * design surviving a save/reload is the default outcome rather than
   * something that needs a second, redundant styling layer to fall back
   * on. A couple of elements still carry a plain `class="aeb-*"` name with
   * NO css behind it — purely as an identification marker (used by the
   * "did our markup get shown as literal text" reload check), never for
   * styling.
   *
   * Responsive behaviour needs no @media breakpoints either: each Product
   * Details row is a full-width flex item with `flex:1 1 100%`, so exactly
   * one field appears on each line on every screen; inside a row, the label and value are themselves
   * flex items (`flex:1 1 43%` / `57%`) with their own `min-width`, so once
   * the row itself gets too narrow to fit both at their minimum widths,
   * they wrap onto their own lines (label above value). About This Item
   * bullets use the same flex-wrap technique at a smaller basis (360px),
   * so they naturally collapse to one column sooner. Type and spacing use
   * `clamp()` for the same reason; a duplicate plain `font-size`/`margin`/
   * `padding-bottom` declaration is kept immediately before each `clamp()`
   * one as a static fallback for anything that doesn't understand
   * `clamp()` — CSS keeps the last valid declaration, so a `clamp()`-aware
   * renderer uses the fluid value and everything else quietly uses the
   * fixed one instead of breaking.
   *
   * To swap in a different design, replace INLINE and renderTemplate()
   * together — they are meant to stay in lockstep.
   * ------------------------------------------------------------------ */

  /** The gold check badge carried inline in the source template. */
  const TICK =
    '<span aria-hidden="true" style="position:absolute;left:4px;top:11px;display:block;width:24px;height:24px;' +
    "border:1px solid #c89d3c;border-radius:50%;color:#b88b29;font-family:Arial,Helvetica,sans-serif;" +
    'font-size:14px;line-height:23px;font-weight:400;text-align:center;">\u2713</span>';

  const INLINE = {
    listing:
      "width:100%;max-width:1180px;min-width:0;box-sizing:border-box;margin:0 auto;background:#fff;color:#24211d;" +
      "font:12px/1.55 Arial,Helvetica,sans-serif;font:clamp(12px,3.7vw,14px)/1.55 Arial,Helvetica,sans-serif;" +
      "white-space:normal;overflow-wrap:anywhere;word-wrap:break-word;",
    section: "box-sizing:border-box;min-width:0;padding:clamp(12px,4vw,24px) 3%;",
    headerWrap: "padding:0 0 20px;border-bottom:1px solid #c8a44d;",
    eyebrow:
      "margin:0 0 8px;color:#96752e;font-size:9px;font-size:clamp(9px,3vw,11px);line-height:1.45;font-weight:700;" +
      "letter-spacing:1.5px;letter-spacing:clamp(1.5px,0.75vw,3px);text-transform:uppercase;",
    headerTitle:
      "margin:0;font-size:18px;font-size:clamp(18px,6vw,24px);line-height:1.3;color:#171717;" +
      "overflow-wrap:anywhere;word-wrap:break-word;",
    rowsWrap: "display:flex;flex-wrap:wrap;min-width:0;width:100%;box-sizing:border-box;",
    row: "display:flex;flex-wrap:wrap;flex:1 1 100%;min-width:0;max-width:100%;box-sizing:border-box;border-bottom:1px solid #dedbd4;",
    rowLabel:
      "flex:1 1 43%;min-width:132px;box-sizing:border-box;padding:clamp(8px,3vw,14px) clamp(6px,3vw,12px);" +
      "border-right:1px solid #dedbd4;font-weight:700;overflow-wrap:anywhere;word-wrap:break-word;",
    rowValue:
      "flex:1 1 57%;min-width:176px;box-sizing:border-box;padding:clamp(8px,3vw,14px) clamp(6px,3vw,12px);" +
      "overflow-wrap:anywhere;word-wrap:break-word;color:#444;",
    aboutSection: "box-sizing:border-box;min-width:0;padding:clamp(12px,4vw,20px) 3% clamp(20px,6vw,32px);",
    aboutTitle:
      "margin:0 0 16px;margin:0 0 clamp(16px,6vw,24px);padding-bottom:12px;padding-bottom:clamp(12px,4vw,17px);" +
      "border-bottom:1px solid #c8a44d;font-size:15px;font-size:clamp(15px,5vw,18px);line-height:1.45;font-weight:400;" +
      "letter-spacing:1px;letter-spacing:clamp(1px,0.5vw,1.8px);text-transform:uppercase;",
    aboutList: "display:flex;flex-wrap:wrap;min-width:0;margin:0;padding:0;list-style:none;",
    aboutLi:
      "position:relative;flex:1 1 360px;min-width:0;max-width:100%;box-sizing:border-box;margin:0;" +
      "padding:clamp(8px,3vw,10px) clamp(6px,3vw,12px) clamp(8px,3vw,10px) 38px;overflow-wrap:anywhere;word-wrap:break-word;",
    strong: "color:#24211d;font-weight:700;",
    noteSection:
      "box-sizing:border-box;min-width:0;padding:clamp(12px,4vw,20px) 3% clamp(20px,6vw,32px);color:#3c3932;" +
      "font-size:13px;font-size:clamp(13px,3.5vw,14px);line-height:1.7;overflow-wrap:anywhere;word-wrap:break-word;",
    noteP: "margin:0;",
  };

  /** One Product Details row: a flex item holding a label cell and a value cell, each their own flex item. */
  function attributeRow(label, value) {
    return (
      `<div style="${INLINE.row}">` +
      `<div style="${INLINE.rowLabel}">${label}</div>` +
      `<div style="${INLINE.rowValue}">${value}</div>` +
      `</div>`
    );
  }

  /**
   * Renders the template.
   * `attributes` is an array of { label, value } with both already escaped and
   * already filtered — the blocklist runs before this point.
   * `bullets` is an array of already-escaped bullet HTML.
   */
  function renderTemplate({ attributes, aboutHeading, bullets, extraText }) {
    const attrs = attributes || [];
    const blocks = [];

    if (attrs.length) {
      blocks.push(
        `<section class="aeb-details" style="${INLINE.section}">` +
          `<div style="${INLINE.headerWrap}">` +
          `<p style="${INLINE.eyebrow}">Essential Specifications</p>` +
          `<h2 style="${INLINE.headerTitle}">Product Details</h2>` +
          `</div>` +
          `<div style="${INLINE.rowsWrap}">${attrs.map((a) => attributeRow(a.label, a.value)).join("")}</div>` +
          `</section>`,
      );
    }

    if (bullets && bullets.length) {
      blocks.push(
        `<section class="aeb-about" style="${INLINE.aboutSection}">` +
          `<h2 style="${INLINE.aboutTitle}">${aboutHeading}</h2>` +
          `<ul style="${INLINE.aboutList}">${bullets.map((b) => `<li style="${INLINE.aboutLi}">${TICK}${b}</li>`).join("")}</ul>` +
          `</section>`,
      );
    }

    if (extraText) {
      blocks.push(`<section class="aeb-note" style="${INLINE.noteSection}"><p style="${INLINE.noteP}">${extraText}</p></section>`);
    }

    if (!blocks.length) return "";
    return `<div class="aeb-listing" style="${INLINE.listing}">${blocks.join("")}</div>`;
  }

  /**
   * Bullets in the reference template lead with a bold caps label
   * ("<strong>THE CLASSIC:</strong> Everyone knows..."). Amazon supplies that
   * lead-in as plain text, so re-create it when the bullet clearly has one.
   * Operates on already-escaped HTML; bullets without a lead-in are untouched.
   */
  function emphasizeBulletLead(escaped) {
    const m = String(escaped).match(/^([^:<]{2,60}):\s+([\s\S]+)$/);
    if (!m) return escaped;
    const lead = m[1].trim();
    if (!lead || lead.split(/\s+/).length > 8) return escaped;
    if (/https?|www\.|\d+\s*$/i.test(lead)) return escaped;
    const letters = lead.replace(/[^A-Za-z]/g, "");
    if (!letters) return escaped;
    const upperRatio = letters.replace(/[^A-Z]/g, "").length / letters.length;
    if (upperRatio < 0.6) return escaped; // ordinary sentence, leave alone
    return `<strong style="${INLINE.strong}">${lead}:</strong> ${m[2]}`;
  }

  /**
   * Rich (text/html) twin of buildDescriptionPlainText, rendered through the
   * template above.
   *
   * Product Details rows are filtered by filterDescriptionAttributes(), so any
   * label containing Brand / Brand Name / Manufacturer / Manufacturer Name /
   * ASIN / Warranty / Guarantee is dropped whole — label and value together.
   * About This Item bullets are never filtered.
   */
  function buildDescriptionHTML(descriptionData) {
    const data = descriptionData || {};
    const attributes = filterDescriptionAttributes(data.attributes).map((a) => ({
      label: escapeHTML(cleanLabel(a.label)),
      value: escapeHTML(String(a.value).trim()),
    }));
    const bullets = filterDescriptionBullets(data.bullets)
      .map((b) => emphasizeBulletLead(escapeHTML(String(b).trim())));

    const safeStandaloneText = filterDescriptionStandaloneText(data.standaloneText);
    const extraText = safeStandaloneText
      ? escapeHTML(safeStandaloneText).replace(/\n+/g, "<br/>")
      : "";

    return renderTemplate({
      attributes,
      aboutHeading: escapeHTML(data.heading || "About This Item"),
      bullets,
      extraText,
    });
  }

  function buildTitleAndDescriptionHTML(title, descriptionData) {
    return `<div style="${F.value}max-width:900px;"><div style="${F.title}margin:0 0 16px;">Title: ${escapeHTML(
      title || "",
    )}</div>${buildDescriptionHTML(descriptionData)}</div>`;
  }

  const PROMPT_INSTRUCTIONS = `INSTRUCTIONS:

Analyze the Amazon Title, Product Details, and About This Item carefully before answering.

STEP 1 — SUGGESTED ITEM SPECIFICS
The Suggested Item Specifics section is provided above:
- Process EVERY suggested option in exactly the same serial as it appears.
- Do not skip, reorder, rename, add, or remove any option.
- Put ✅ before the option if the exact suggested value is supported by the Amazon product information.
- Put ❌ before it if the suggested value is incorrect, unsupported, contradictory, or cannot be confirmed confidently.
- Never guess.

Output example:
✅ Brand: Example Brand
❌ Color: Black
✅ Material: Plastic
❌ Features: Waterproof
✅ Unit Type: Unit

STEP 2 — REQUIRED FIELDS
After completing Suggested Item Specifics, fill ONLY the Required fields supplied above.
- Keep the exact same serial as it appears.
- Do not create additional fields.
- Determine the most accurate value using the Title, Product Details, and About This Item.
- If the correct information cannot be determined confidently, write: Not Applicable / Blank

STRICT RULES:
1. Always complete Suggested Item Specifics FIRST.
2. Required fields must always come AFTER Suggested Item Specifics.
3. Only analyze fields explicitly supplied under those sections.
4. Never invent extra Item Specifics.
5. Never provide explanations, reasons, notes, warnings, recommendations, summaries, or commentary.
6. Never guess an unsupported value.
7. A Suggested Item Specific must receive either ✅ or ❌.
8. Required fields that cannot be determined confidently must use "Not Applicable / Blank".
9. Preserve the exact field names and their original order.
10. Base the answer only on the supplied product information.
11. Compatibility does not automatically prove material, feature, specification, certification, model, size, warranty, or other attributes.
12. Do not treat an eBay suggested value as true merely because eBay suggested it.
13. If product information contradicts an eBay suggestion, mark it ❌.
14. Do not output any field that was not supplied.

IMPORTANT OUTPUT RULE: Return ONLY the completed Item Specifics. No reasoning or additional text.`;

  /**
   * PROMPT-ONLY: Format description body for Prompt output.
   * No ## heading, no bullet dashes, no extra blank line after "About this item".
   * Does NOT affect Copy Description or Copy Title & Description (which use buildDescriptionPlainText).
   */
  function buildPromptDescription(descriptionData) {
    const data = descriptionData || {};
    const attributes = filterAttributes(data.attributes);
    const bullets = (data.bullets || []).filter((b) => String(b || "").trim());
    const blocks = [];
    
    // Product Details table (Prompt format - simple key: value)
    const table = buildPromptAttributesTable(attributes);
    if (table) blocks.push(table);
    
    // About this item section (no ##, no - prefix, no blank line after heading)
    if (bullets.length) {
      const heading = data.heading || "About this item";
      blocks.push(`${heading}\n${bullets.map((b) => String(b).trim()).join("\n")}`);
    }
    
    if (data.standaloneText) blocks.push(String(data.standaloneText).trim());
    
    // Single blank line between sections
    return blocks.join("\n\n");
  }

  /**
   * PROMPT-ONLY: Format title + description for Prompt output.
   * Returns: "Title: ...\n\n<description>"
   */
  function buildPromptTitleAndDescription(title, descriptionData) {
    return `Title: ${title || ""}\n\n${buildPromptDescription(descriptionData)}`.trim();
  }

  function buildPrompt({ title, descriptionData, suggested, required }) {
    const blocks = [buildPromptTitleAndDescription(title, descriptionData)];
    const s = (suggested || []).filter((x) => String(x || "").trim());
    const r = (required || []).filter((x) => String(x || "").trim());
    if (s.length) blocks.push(`Suggested Item Specifics:\n${s.join("\n")}`);
    if (r.length) blocks.push(`Required:\n${r.join("\n")}`);
    blocks.push(PROMPT_INSTRUCTIONS);
    return blocks.join("\n\n");
  }

  function buildTitleHTML(title) {
    return `<div style="${F.title}">${escapeHTML(title || "")}</div>`;
  }

  return {
    EXCLUDED_LABELS,
    normalizeLabel,
    isExcludedLabel,
    BLOCKED_DETAIL_TERMS,
    isBlockedDetailLabel,
    escapeHTML,
    filterAttributes,
    filterDescriptionAttributes,
    containsWebsiteOrEmail,
    filterDescriptionBullets,
    filterDescriptionStandaloneText,
    attributesTable,
    buildPromptAttributesTable,
    buildDescriptionHTML,
    renderTemplate,
    emphasizeBulletLead,
    buildDescriptionPlainText,
    buildTitleAndDescriptionPlainText,
    buildTitleAndDescriptionHTML,
    buildPrompt,
    buildTitleHTML,
    PROMPT_INSTRUCTIONS,
    FONTS: F,
  };
});
