const D=require(require("path").join(__dirname,"..","common","descriptionBuilder.js"));
let pass=0,fail=0;
const ck=(n,c,e)=>c?(pass++,console.log("  PASS  "+n)):(fail++,console.log("  FAIL  "+n+(e?" -- "+e:"")));
const A=(n)=>Array.from({length:n},(_,i)=>({label:"Label"+i,value:"Value"+i}));

console.log("\n[E1] Several attributes -> one independent flex row per attribute, no spanning/pairing needed");
{const h=D.buildDescriptionHTML({attributes:A(9),bullets:["a"]});
 ck("Product Details section present", h.includes('class="aeb-details"'));
 ck("exactly 9 rows rendered (one per attribute, no pairing)", (h.match(/flex:1 1 420px/g)||[]).length===9);
 ck("Product Details heading still present", h.includes(">Product Details<"));
 ck("balanced div", (h.match(/<div/g)||[]).length===(h.match(/<\/div>/g)||[]).length);}

console.log("\n[E2] A single attribute still renders as its own complete row (no partner needed)");
{const h=D.buildDescriptionHTML({attributes:A(1),bullets:["a"]});
 ck("exactly one row", (h.match(/flex:1 1 420px/g)||[]).length===1);
 ck("label and value both present, not empty", h.includes(">Label0<") && h.includes(">Value0<"));}

console.log("\n[E3] Odd number of attributes -> every row still complete (no old table 'spanning' concept survives)");
{const h=D.buildDescriptionHTML({attributes:A(7),bullets:["a"]});
 ck("exactly 7 independent rows", (h.match(/flex:1 1 420px/g)||[]).length===7);
 ck("no leftover colspan attribute anywhere (not a table)", !h.includes("colspan"));
 ck("no empty label or value div", !/<div style="[^"]*flex:1 1 (43|57)%[^"]*">\s*<\/div>/.test(h));}

console.log("\n[E4] No bullets -> no About This Item section, Product Details still renders");
{const h=D.buildDescriptionHTML({attributes:A(4)});
 ck("no About section", !h.includes('class="aeb-about"'));
 ck("Product Details section still rendered", h.includes('class="aeb-details"'));}

console.log("\n[E5] Everything blocked -> no orphan Product Details section");
{const blocked=[{label:"Brand",value:"X"},{label:"ASIN",value:"Y"},{label:"Warranty Type",value:"Z"}];
 const h=D.buildDescriptionHTML({attributes:blocked,bullets:["Nice item"]});
 ck("no Product Details section at all (nothing survived the blocklist)", !h.includes('class="aeb-details"'), h.slice(0,120));
 ck("About section still rendered", h.includes('class="aeb-about"'));
 ck("blocked values absent", !h.includes(">X<")&&!h.includes(">Y<")&&!h.includes(">Z<"));}

console.log("\n[E6] Nothing at all -> empty string, never a hollow shell");
{ck("empty output", D.buildDescriptionHTML({})==="" , JSON.stringify(D.buildDescriptionHTML({}).slice(0,60)));}

console.log("\n[E7] standaloneText rendered on its own, alongside nothing else");
{const h=D.buildDescriptionHTML({attributes:A(2),standaloneText:"Line one\nLine two"});
 ck("note section present", h.includes('class="aeb-note"'));
 ck("newline -> <br/>", h.includes("Line one<br/>Line two"));}

console.log("\n[E8] Escaping / injection safety");
{const h=D.buildDescriptionHTML({attributes:[{label:'<img src=x onerror=alert(1)>',value:'"><script>bad()</script>'}],
   bullets:['<b>raw</b> & "quoted"'], standaloneText:'a & b <script>x</script>'});
 ck("no raw <script>", !h.includes("<script>"));
 ck("hostile <img> neutralised (escaped, not a tag)", !/<img\s+src=x/.test(h) && h.includes("&lt;img src=x onerror=alert(1)&gt;"));
 ck("bullet <b> escaped", !h.includes("<b>raw</b>"));
 ck("ampersand in standalone text escaped", h.includes("a &amp; b"));
 ck("no leftover onerror handler from the old (removed) image-fallback feature", !h.includes("this.style.display="));
 // A real (unescaped) tag with an event-handler attribute would need a literal
 // "<" character right before it; escaped content only ever contains the
 // 4-character sequence "&lt;", never a bare "<", so this can't false-positive
 // on the safely-neutralised hostile input above.
 ck("no genuine unescaped tag carries an event-handler attribute", !/<[a-zA-Z][^<>&]*\son\w+\s*=/.test(h));}

console.log("\n[E9] Bold lead-in heuristics (unrelated to layout, unchanged)");
{const e=D.emphasizeBulletLead;
 ck("CAPS lead bolded", /^<strong[^>]*>THE CLASSIC:<\/strong> Everyone knows$/.test(e("THE CLASSIC: Everyone knows")));
 ck("multiword CAPS bolded", /^<strong[^>]*>/.test(e("PLAYING TIME AND PLAYERS: Designed for 2-4")));
 ck("normal sentence untouched", e("This item is great: really")==="This item is great: really");
 ck("no colon untouched", e("Made in the USA")==="Made in the USA");
 ck("URL untouched", e("https: //example.com is the site")==="https: //example.com is the site");}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail?1:0);
