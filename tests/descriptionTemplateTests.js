const D = require(require("path").join(__dirname,"..","common","descriptionBuilder.js"));
let pass=0,fail=0;
const ck=(n,c,e)=>c?(pass++,console.log("  PASS  "+n)):(fail++,console.log("  FAIL  "+n+(e?" -- "+e:"")));

console.log("\n[A] Blocked label matching (LABEL contains, case-insensitive)");
[["Brand",1],["brand",1],["Brand Name",1],["BRAND NAME",1],["Manufacturer",1],
 ["Manufacturer Name",1],["Manufacturer Part Number",1],
 ["Manufacturer Warranty Description",1],["ASIN",1],["asin",1],
 ["Warranty",1],["Warranty Type",1],["Limited Warranty",1],
 ["Guarantee",1],["Money Back Guarantee",1],
 ["Color",0],["Material",0],["Item Weight",0],["Number of Players",0],
 ["Product Dimensions",0],["Country of Origin",0],["Age Range",0]
].forEach(([l,b])=>ck(`${b?"blocks":"keeps "} "${l}"`, D.isBlockedDetailLabel(l)===!!b));

console.log("\n[B] Rows are dropped whole (no empty label/value row)");
const attrs=[
 {label:"Brand",value:"Winning Moves"},
 {label:"Brand Name",value:"Winning Moves"},
 {label:"Manufacturer",value:"Winning Moves"},
 {label:"Manufacturer Part Number",value:"1189"},
 {label:"Manufacturer Warranty Description",value:"30 day warranty against manufacturer defects"},
 {label:"ASIN",value:"B00MC5X94A"},
 {label:"Warranty Type",value:"Limited"},
 {label:"Money Back Guarantee",value:"Yes"},
 {label:"Number of Players",value:"2-6"},
 {label:"Material",value:"Cardboard"},
 {label:"Item Weight",value:"1.2 pounds"},
];
const kept=D.filterDescriptionAttributes(attrs).map(a=>a.label);
ck("keeps exactly the 3 allowed rows", JSON.stringify(kept)===JSON.stringify(["Number of Players","Material","Item Weight"]), JSON.stringify(kept));

const data={attributes:attrs,heading:"About this item",
 bullets:["Trusted brand quality since 1889","Backed by a manufacturer warranty for peace of mind","Includes 6 tokens"]};
const html=D.buildDescriptionHTML(data);

console.log("\n[C] Rendered HTML");
["Winning Moves","B00MC5X94A","1189","30 day warranty","Warranty Type","Money Back Guarantee"]
 .forEach(v=>ck(`blocked value absent from Product Details: "${v}"`, !html.includes(v)));
["Number of Players","2-6","Material","Cardboard","Item Weight","1.2 pounds"]
 .forEach(v=>ck(`kept: "${v}"`, html.includes(v)));

console.log("\n[D] Normal About This Item bullets remain");
ck("bullet mentioning 'brand' kept", html.includes("Trusted brand quality since 1889"));
ck("bullet mentioning 'manufacturer warranty' kept", html.includes("Backed by a manufacturer warranty for peace of mind"));

console.log("\n[E] Template structure (flex-wrap responsive design, no image, no table)");
ck("Product Details heading present", html.includes(">Product Details<"));
ck("About this item heading present", html.includes(">About this item<"));
ck("no image markup of any kind", !html.includes("<img"));
ck("no table markup of any kind", !html.includes("<table"));
ck("no @media breakpoints (fluid clamp()-based responsiveness instead)", !html.includes("@media"));
ck("clamp() drives the fluid spacing/typography", html.includes("clamp("));
ck("every Product Details row is full width", html.includes("flex:1 1 100%") && !html.includes("flex:1 1 420px"));
ck("no empty row rendered", !/<div style="[^"]*flex:1 1 (43|57)%[^"]*">\s*<\/div>/.test(html));
ck("bullets in a <ul>", /<ul[^>]*>[\s\S]*<li/.test(html));

console.log("\n[F] Prompt path is UNCHANGED (still uses the shared filter)");
const promptKept=D.filterAttributes(attrs).map(a=>a.label);
ck("Prompt filter still keeps Manufacturer Part Number", promptKept.includes("Manufacturer Part Number"));
ck("Prompt filter still keeps Warranty Type", promptKept.includes("Warranty Type"));
ck("Prompt filter still drops exact 'Brand'", !promptKept.includes("Brand"));
const p=D.buildPrompt({title:"T",descriptionData:data,suggested:["Brand: X"],required:["Type"]});
ck("Prompt still contains Manufacturer Part Number", p.includes("Manufacturer Part Number"));
ck("Prompt instructions intact", p.includes("STEP 1 — SUGGESTED ITEM SPECIFICS"));
const promptTable=D.buildPromptAttributesTable([
 {label:"Color",value:"S1-Matte Black"},
 {label:"Material",value:"Aluminum"},
 {label:"Pattern",value:"Money clip wallets for men"},
]);
const promptTableLines=promptTable.split("\n");
ck("Prompt block starts with the requested blank marker", promptTableLines[0]==="|   |" && promptTableLines[1]==="| - |", promptTableLines.slice(0,2).join(" / "));
ck("one blank line follows the marker", promptTableLines[2]==="", JSON.stringify(promptTableLines[2]));
ck("first attribute is a plain Field: Value line", promptTableLines[3]==="Color: S1-Matte Black", promptTableLines[3]);
ck("remaining attributes are plain Field: Value lines", promptTableLines[4]==="Material: Aluminum" && promptTableLines[5]==="Pattern: Money clip wallets for men", promptTableLines.slice(4).join(" / "));
ck("Prompt Product Details contain no bold Markdown cells", !promptTable.includes("**") && !promptTable.includes("| **"));

console.log("\n[G] Websites, links and email details are excluded from Description output");
const unsafe={
 attributes:[
  {label:"Support website",value:"Example"},
  {label:"Instructions",value:"Visit https://example.com/help"},
  {label:"Seller note",value:"www.example.co.uk"},
  {label:"Contact",value:"sales@example.com"},
  {label:"Color",value:"Blue"},
 ],
 bullets:["Email support@example.com", "Visit example dot com", "Follow us on Instagram", "Durable blue finish"],
 standaloneText:"Business mail: help [at] example [dot] com",
};
const safeHtml=D.buildDescriptionHTML(unsafe);
const safePlain=D.buildDescriptionPlainText(unsafe);
["example.com","example.co.uk","support@example.com","Instagram","Business mail","Support website"]
 .forEach(v=>ck(`unsafe content removed: ${v}`, !safeHtml.toLowerCase().includes(v.toLowerCase()) && !safePlain.toLowerCase().includes(v.toLowerCase())));
ck("safe attribute remains", safeHtml.includes("Blue"));
ck("safe bullet remains", safeHtml.includes("Durable blue finish"));

[
 "https://example.com/path",
 "hxxps://example.com",
 "ftp://files.example.net",
 "mailto:help@example.com",
 "www.example.org",
 "shop.example.store",
 "example [dot] com",
 "example (.) com",
 "example．com",
 "help @ example . com",
 "help [at] example [dot] com",
 "help＠example．com",
 "Contact us for details",
 "Our Google page",
 "Follow our Facebook account",
].forEach((sample)=>ck(`detects obfuscated web/contact form: ${sample}`, D.containsWebsiteOrEmail(sample)));
[
 "Water-resistant finish",
 "Compatible with 4-inch parts",
 "Use at home or at work",
 "Includes printed instructions",
].forEach((sample)=>ck(`keeps ordinary product text: ${sample}`, !D.containsWebsiteOrEmail(sample)));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail?1:0);
