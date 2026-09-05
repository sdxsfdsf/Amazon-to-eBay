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

console.log("\n[D] About This Item bullets are NOT filtered");
ck("bullet mentioning 'brand' kept", html.includes("Trusted brand quality since 1889"));
ck("bullet mentioning 'manufacturer warranty' kept", html.includes("Backed by a manufacturer warranty for peace of mind"));

console.log("\n[E] Template structure (flex-wrap responsive design, no image, no table)");
ck("Product Details heading present", html.includes(">Product Details<"));
ck("About this item heading present", html.includes(">About this item<"));
ck("no image markup of any kind", !html.includes("<img"));
ck("no table markup of any kind", !html.includes("<table"));
ck("no @media breakpoints (fluid clamp()-based responsiveness instead)", !html.includes("@media"));
ck("clamp() drives the fluid spacing/typography", html.includes("clamp("));
ck("Product Details rows use the flex-wrap technique", html.includes("flex:1 1 420px"));
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

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail?1:0);
