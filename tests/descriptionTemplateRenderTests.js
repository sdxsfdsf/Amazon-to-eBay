const D=require(require("path").join(__dirname,"..","common","descriptionBuilder.js"));
const fs=require("fs");
// Exactly the attribute set from the supplied template (blocked ones included on purpose)
const attributes=[
 {label:"Brand Name",value:"Winning Moves"},
 {label:"Genre",value:"Preschool & Family Game"},
 {label:"Number of Players",value:"2-4"},
 {label:"Edition",value:"65th Anniversary Edition"},
 {label:"Customer Package Type",value:"Standard Packaging"},
 {label:"Unit Count",value:"1 Count"},
 {label:"Estimated Playing Time",value:"15 minutes"},
 {label:"Number of Packs",value:"1"},
 {label:"Included Components",value:'Game includes heavy-duty gameboard, 4 plastic gingerbread movers, deck of 64 cards, and instructions including "The Story of Candy Land"'},
 {label:"Age Range Description",value:"4 and up"},
 {label:"Global Trade Identification Number",value:"00714043011892"},
 {label:"Item Part Number",value:"WNM1189"},
 {label:"Item Type Name",value:"Preschool Family Game"},
 {label:"Manufacturer",value:"Winning Moves"},
 {label:"Minimum Age Recommendation",value:"36"},
 {label:"Model Number",value:"1189"},
 {label:"UPC",value:"885215287459 787799747940"},
 {label:"Manufacturer Warranty Description",value:"30 day warranty against manufacturer defects"},
 {label:"Manufacturer Part Number",value:"1189"},
 {label:"Set Name",value:"65th Anniversary Edition"},
 {label:"Best Sellers Rank",value:"#28,743 in Toys & Games; #674 in Board Games"},
 {label:"ASIN",value:"B00MC5X94A"},
 {label:"Manufacturer Recommended Age",value:"4 years and up"},
 {label:"Additional Features",value:"Lightweight"},
 {label:"Supported Battery Types",value:"No batteries required"},
 {label:"Educational Objective",value:"Learning counting, turn taking, color recognition, and color matching"},
 {label:"Indoor Outdoor Usage",value:"Indoor"},
 {label:"Operation Mode",value:"operation"},
 {label:"Item Dimensions L x W",value:'15.75"L x 15.75"W'},
 {label:"Item Weight",value:"1 pound"},
 {label:"Number of Items",value:"1"},
 {label:"Item Dimensions",value:"10.5 x 10.5 x 1.5 inches"},
 {label:"Size",value:"One size fits most"},
 {label:"Theme",value:"Board Game"},
 {label:"Color",value:"Multicolor"},
 {label:"Material Type",value:"Paper"},
];
const bullets=[
 "Paper",
 "Made in the USA",
 "THE CLASSIC: Everyone knows the game of Candy Land. This classic edition features the original, charming artwork from the games' early days.",
 "RACE TO HOME SWEET HOME: Kids encounter all kinds of delicious fun as they move their cute gingerbread pawn through Gum Drop Mountains, Lollypop Woods, the Molasses Swamp and more.",
 "NO READING REQUIRED: Since it's for kids ages 3 and up, Candy Land is suitable for those who haven't learned how to read yet.",
 "A FAMILY FAVORITE: Cherish your child's early years by making memories with Candy Land.",
 "SKILLS: All in the name of fun. Children will learn counting, turn taking, color recognition, and color matching.",
 "GAME COMPONENTS: Includes a heavy duty game board, 4 plastic gingerbread men movers, a deck of 64 colorful cards.",
 "PLAYING TIME AND PLAYERS: Designed for 2-4 players with an average playing time of 15-20 minutes per game session.",
];
const data={attributes,bullets,heading:"About This Item"};
const html=D.buildDescriptionHTML(data);
fs.writeFileSync(require("path").join(require("os").tmpdir(),"rendered.html"),"<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'></head><body style='margin:0'>"+html+"</body></html>");

let pass=0,fail=0;
const ck=(n,c,e)=>c?(pass++,console.log("  PASS  "+n)):(fail++,console.log("  FAIL  "+n+(e?" -- "+e:"")));

console.log("\n[1] Blocked labels stripped from Product Details");
["Brand Name","Manufacturer<","Manufacturer Warranty Description","Manufacturer Part Number","ASIN","Manufacturer Recommended Age"]
 .forEach(l=>ck(`removed "${l.replace('<','')}"`, !html.includes(">"+l.replace('<','')+"<")));
ck('value "Winning Moves" gone', !html.includes("Winning Moves"));
ck('value "B00MC5X94A" gone', !html.includes("B00MC5X94A"));
ck('value "30 day warranty" gone', !html.includes("30 day warranty"));

console.log("\n[2] Allowed labels kept");
["Genre","Number of Players","Edition","Unit Count","Included Components","Theme","Color","Material Type"]
 .forEach(l=>ck(`kept "${l}"`, html.includes(">"+l+"<")));

console.log("\n[3] Template structure matches the new responsive reference");
ck("aeb-listing wrapper (identification marker only, no CSS behind it)", html.includes('class="aeb-listing"'));
ck("Product Details section", html.includes('class="aeb-details"'));
ck("no <table> anywhere (flex-based rows, not a table)", !html.includes("<table"));
ck("no <style> block at all (every rule lives inline)", !html.includes("<style>"));
ck("no image markup of any kind (image feature removed)", !html.includes("<img"));
ck("eyebrow 'Essential Specifications'", html.includes(">Essential Specifications<"));
ck("h2 'Product Details'", html.includes(">Product Details<"));
ck("one full-width flex row per attribute", (html.match(/flex:1 1 100%/g) || []).length === attributes.length - 6 /* 6 blocked */);
ck("row label uses the 43% flex basis", html.includes("flex:1 1 43%"));
ck("row value uses the 57% flex basis", html.includes("flex:1 1 57%"));
ck("row label has its own min-width (for the stack-on-narrow behaviour)", html.includes("min-width:132px"));
ck("row value has its own min-width", html.includes("min-width:176px"));
ck("About This Item section", html.includes('class="aeb-about"'));
ck("About This Item heading", html.includes(">About This Item<"));
ck("About This Item bullets use their own flex-wrap (flex:1 1 360px)", html.includes("flex:1 1 360px"));
ck("gold tick badge on bullets", html.includes("\u2713"));
ck("bold lead-in generated", /<strong[^>]*>THE CLASSIC:<\/strong>/.test(html));
ck("plain bullet NOT bolded", html.includes(">Paper</li>")||html.includes("</span>Paper</li>"));
ck("clamp() used for fluid type/spacing (no media queries needed)", html.includes("clamp("));
ck("no @media breakpoints anywhere (fluid, not stepped)", !html.includes("@media"));
// Progressive-enhancement fallback: a plain declaration immediately before
// the clamp() one, for anything that doesn't understand clamp().
ck("font-size has a static fallback before its clamp() value", /font-size:\d+px;font-size:clamp\(/.test(html));

console.log("\n[4] No script/style injection surface (everything is plain inline style)");
ck("no <script> tag", !html.includes("<script"));
ck("no <style> tag", !html.includes("<style"));
ck("no onerror/onclick or other inline event handler (nothing dynamic to sanitize away)", !/\son[a-z]+\s*=/i.test(html));

console.log("\n[5] Structural integrity");
const opens=(html.match(/<div/g)||[]).length, closes=(html.match(/<\/div>/g)||[]).length;
ck("div tags balanced", opens===closes, opens+" vs "+closes);
const sOpen=(html.match(/<section/g)||[]).length, sClose=(html.match(/<\/section>/g)||[]).length;
ck("section tags balanced", sOpen===sClose, sOpen+" vs "+sClose);
ck("no empty row label/value cell", !/<div style="[^"]*flex:1 1 (43|57)%[^"]*">\s*<\/div>/.test(html));
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail?1:0);
