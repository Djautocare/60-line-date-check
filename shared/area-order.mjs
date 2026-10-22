// Catalogue areas determine quotas. Walking groups only determine the route.
export const CHECK_AREA_ORDER=Object.freeze(['Bread','Chilled produce','Ambient produce','Short life','Long life']);
const definitions=[
 ['bread','Bread','Bread'],
 ['food-to-go','Food to go','Food to go'],
 ['chilled-prepared-fruit','Prepared fruit','Chilled produce'],
 ['chilled-grapes','Grapes','Chilled produce'],
 ['chilled-berries','Berries','Chilled produce'],
 ['chilled-whole-fruit','Other chilled whole fruit','Chilled produce'],
 ['chilled-salads','Salad bags and salads','Chilled produce'],
 ['chilled-prepared-veg','Prepared vegetables','Chilled produce'],
 ['chilled-other-veg','Other vegetables','Chilled produce'],
 ['chilled-other','Other chilled produce','Chilled produce'],
 ['chilled-stir-fry','Stir fry, sauces and noodles','Chilled produce'],
 ['chilled-mushrooms','Mushrooms','Chilled produce'],
 ['chilled-herbs','Herbs','Chilled produce'],
 ['ambient-potatoes','Potatoes','Ambient produce'],
 ['ambient-roots','Carrots, roots and squash','Ambient produce'],
 ['ambient-onions','Onions','Ambient produce'],
 ['ambient-peppers','Peppers and chillies','Ambient produce'],
 ['ambient-tomatoes','Tomatoes','Ambient produce'],
 ['ambient-bananas','Bananas','Ambient produce'],
 ['ambient-pineapples','Pineapples','Ambient produce'],
 ['ambient-melons','Melons','Ambient produce'],
 ['ambient-exotic-fruit','Other exotic fruit','Ambient produce'],
 ['ambient-citrus','Citrus fruit','Ambient produce'],
 ['ambient-apples','Apples','Ambient produce'],
 ['ambient-pears','Pears','Ambient produce'],
 ['ambient-aubergines','Aubergines and courgettes','Ambient produce'],
 ['ambient-other','Other ambient produce','Ambient produce'],
 ['ambient-cucumbers','Cucumbers','Ambient produce'],
 ['short-chicken','Raw chicken','Short life'],
 ['short-turkey','Raw turkey','Short life'],
 ['short-beef-lamb','Raw beef and lamb','Short life'],
 ['short-pork-gammon','Raw pork and gammon','Short life'],
 ['short-bacon','Bacon','Short life'],
 ['short-sausages','Sausages and pigs in blankets','Short life'],
 ['short-fish','Fish and seafood','Short life'],
 ['short-other','Other short life','Short life'],
 ['long-pastries-pies','Chilled savoury pastries and pies','Long life'],
 ['long-quiche','Quiche','Long life'],
 ['long-dips-salads','Dips, coleslaw and salad tubs','Long life'],
 ['long-sausage-rolls','Sausage rolls','Long life'],
 ['long-satay','Satay skewers','Long life'],
 ['long-butter-dough','Butter, pastry and cookie dough','Long life'],
 ['long-protein-dairy','Protein yoghurts and dairy','Long life'],
 ['long-yoghurts','Yoghurts','Long life'],
 ['long-desserts','Desserts','Long life'],
 ['long-milk-cream','Milk, cream and milkshakes','Long life'],
 ['long-cheese','Cheese','Long life'],
 ['long-juice','Fresh juices and smoothies','Long life'],
 ['long-vegetarian-vegan','Vegetarian and vegan products','Long life'],
 ['long-ready-meals','Ready meals, traybakes and curries','Long life'],
 ['long-fresh-pasta','Fresh pasta and pasta sauces','Long life'],
 ['long-pizza','Pizzas','Long life'],
 ['long-sandwich-meats','Deli and sandwich meats','Long life'],
 ['long-chorizo-salami','Chorizo, salami and continental meats','Long life'],
 ['long-other','Other long life','Long life'],
];
export const WALKING_GROUPS=Object.freeze(definitions.map(([id,label,area],rank)=>Object.freeze({id,label,area,rank})));
const groups=new Map(WALKING_GROUPS.map(group=>[group.id,group]));
/** @param {unknown} value */
export const validWalkingGroup=value=>typeof value==='string'&&groups.has(value);
const normalise=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/([a-z])([0-9])/g,'$1 $2').replace(/[^a-z0-9]+/g,' ').trim();
function areaKind(section){
 const area=normalise(section).replaceAll(' ','');
 if(['bread','breadchiller','bakery'].includes(area))return 'bread';
 if(['foodtogo','ftg'].includes(area))return 'food-to-go';
 if(['chilledproduce','chilledprod','producechiller','prodchiller'].includes(area))return 'chilled';
 if(['ambientproduce','ambientprod','produce','prod'].includes(area))return 'ambient';
 if(['shortlife','shortlifechiller'].includes(area))return 'short';
 if(['longlife','longlifechiller'].includes(area))return 'long';
 if(['vegetarian','vegan','vegetarianvegan','meatalternatives'].includes(area))return 'vegetarian';
 return '';
}
/** @param {string} name */
function produceGroup(name){
 // Preparation wins over the fruit/vegetable it contains: plum tomatoes and
 // apple/grape snack packs must not be mistaken for whole plums or grapes.
 if(/\b(fruit salad|fruit pot|fruit platter|fruit medley|pomegranate seeds|pineapple chunks|mango chunks|melon medley|watermelon fans|fans watermelon)\b/.test(name)||/\b(apple|mango|melon|watermelon|pineapple|fruit)\b.*\b(chunks|fingers|pieces|snack|prepared|slices|wedges|cubes|spears|segments)\b/.test(name)||/\b(prepared|sliced|diced)\b.*\b(fruit|melon|mango|pineapple)\b/.test(name))return 'chilled-prepared-fruit';
 if(/\b(stir fry|stirfry|wok|noodles?|noodle|teriyaki)\b/.test(name)||/^sf\b/.test(name))return 'chilled-stir-fry';
 if(/\b(mushrooms?|chestnut mushrooms?)\b/.test(name))return 'chilled-mushrooms';
 if(/\b(basil|coriander|parsley|mint|rosemary|thyme|chives|dill|sage|tarragon|herbs?)\b/.test(name))return 'chilled-herbs';
 if(/\b(salad|salads|lettuce|rocket|watercress|baby leaf|babyleaf|baby spinach|butterhead|peashoot|iceberg|little gem|sweet gem|spring onions?|celery|radish|radishes)\b/.test(name)||/\bwsr\b/.test(name))return 'chilled-salads';
 if(/\b(prep|prepared|diced|chopped|shredded|batons?|florets?|medley|layered|steam)\b/.test(name)||/\bpotato\w*\b.*\bslices\b/.test(name))return 'chilled-prepared-veg';
 if(/\bgrapes?\b/.test(name))return 'chilled-grapes';
 if(/\b(\w*berr(?:y|ies)|currants?)\b/.test(name))return 'chilled-berries';
 if(/\b(plums?|peaches?|nectarines?|apricots?|cherries)\b/.test(name)&&!name.includes('tomato'))return 'chilled-whole-fruit';
 if(/\bpotato(?:es)?\b/.test(name))return 'ambient-potatoes';
 if(/\b(carrots?|parsnips?|swede|turnips?|beetroot|beets?|butternut|squash|squashes|pumpkins?|garlic|ginger|celeriac)\b/.test(name))return 'ambient-roots';
 if(/\b(onions?|shallots?)\b/.test(name))return 'ambient-onions';
 if(/\b(peppers?|chillies|chilli|chili|scotch bonnet)\b/.test(name))return 'ambient-peppers';
 if(/\btomato(?:es)?\b/.test(name))return 'ambient-tomatoes';
 if(/\bbananas?\b/.test(name))return 'ambient-bananas';
 if(/\bpineapples?\b/.test(name))return 'ambient-pineapples';
 if(/\b(watermelons?|melons?|honeydew|galia|cantaloupe)\b/.test(name))return 'ambient-melons';
 if(/\b(mango(?:es|s)?|kiwi|kiwis|avocados?|figs?|pomegranate|papaya|passion ?fruit|dragon ?fruit|coconuts?|lychee|lychees|persimmon|sharon)\b/.test(name))return 'ambient-exotic-fruit';
 if(/\b(oranges?|lemons?|limes?|grapefruits?|easy peelers?|satsumas?|clementines?|mandarins?|tangerines?|pomelo)\b/.test(name))return 'ambient-citrus';
 if(/\bapples?\b/.test(name))return 'ambient-apples';
 if(/\bpears?\b/.test(name))return 'ambient-pears';
 if(/\b(aubergines?|courgettes?|eggplants?|zucchini)\b/.test(name))return 'ambient-aubergines';
 if(/\bcucumbers?\b/.test(name))return 'ambient-cucumbers';
 if(/\b(broccoli|broc|cauliflower|cauli|cabbage|cavolo|kale|greens|spinach|beans?|beansprouts?|asparagus|mangetout|peas?|sweetcorn|babycorn|pak choi|chard|leeks?|sprouts?)\b/.test(name))return 'chilled-other-veg';
 return '';
}
const meal=/\b(meals?|curry|curries|masala|jalfrezi|vindal\w*|korma|rogan|bhuna|tikka|lasagne|lasagna|pies?|pasta|ravioli|tortell\w*|bakes?|tray ?bakes?|pizza|paella|patatas|risotto|carbonara|al forno|puddings?|mac cheese|macaroni|lattice|rolls?|flatbreads?)\b/;
const cookedMeat=/\b(cooked|roast|roasted|sliced|slices|wafer|deli|breaded|battered|goujons?|nuggets?|kievs?|kyivs?|southern fried|satay|forresters|forre|naw|no added water|wt)\b/;
function shortLifeGroup(name){
 if(meal.test(name))return 'short-other';
 if(/\b(fish|seafood|salmon|cod|haddock|trout|tuna|sea ?bass|sea ?bream|mackerel|basa|hake|pollock|plaice|sole|kippers?|prawns?|shrimp|scallops?|mussels?|crab|sardines?)\b/.test(name))return 'short-fish';
 if(/\b(sausages?|chipolatas?|bratwurst|frankfurters?|pigs in blankets)\b/.test(name))return 'short-sausages';
 if(/\b(bacon|rashers?|lardons?)\b/.test(name))return 'short-bacon';
 if(cookedMeat.test(name))return 'short-other';
 if(/\bchicken\b/.test(name))return 'short-chicken';
 if(/\bturkey\b/.test(name))return 'short-turkey';
 if(/\b(beef|lamb|veal)\b/.test(name))return 'short-beef-lamb';
 if(/\b(pork|gammon)\b/.test(name))return 'short-pork-gammon';
 return 'short-other';
}
function longLifeGroup(name){
 // Specific products win over ingredients: sausage rolls before sausages,
 // cream cheese before cream, and ready-meal pasta before fresh pasta.
 if(/\byorkshire puddings?\b/.test(name))return 'long-pastries-pies';
 if(/\b(cottage pie|shepherds? pie|fish pie|cauliflower cheese|cauli cheese|mac cheese|macaroni|butter basted|gammon shanks?)\b/.test(name))return 'long-ready-meals';
 if(/\bquiche\w*\b/.test(name))return 'long-quiche';
 if(/\b(dips?|hummus|houmous|coleslaw|cole slaw|potato salad|pasta salad|tzatziki|guacamole|salsa|taramasalata)\b/.test(name))return 'long-dips-salads';
 if(/\b(sausage rolls?|pork rolls?)\b/.test(name))return 'long-sausage-rolls';
 if(/\b(satay|skewers?)\b/.test(name))return 'long-satay';
 if(/\b(butter|margarine|spreadable|spreads?|cookie dough|puff pastry|filo pastry|shortcrust|pastry sheets?|pastry dough|ready rolled|jus rol)\b/.test(name)&&!meal.test(name)&&! /\b(chicken|beef|pork|fish|cheese|cauliflower)\b/.test(name))return 'long-butter-dough';
 if(/\b(pies?|pastries|pasties?|pasty|sausage plait|lattice|wellington|savoury pastry)\b/.test(name)&&! /\b(apple|cherry|chocolate|custard|fruit|mince pies?)\b/.test(name))return 'long-pastries-pies';
 if(/\b(protein|skyr|kvarg|quark)\b/.test(name)&&/\b(yoghurt|yogurt|yoghurts|yogurts|pudding|mousse|desserts?|cheese|dairy|pot|pots|drink|milk|shake|shakes|quark|kvarg|skyr)\b/.test(name))return 'long-protein-dairy';
 if(/\b(yog\w*|fromage frais|kefir|probiotic)\b/.test(name))return 'long-yoghurts';
 if(/\bcreme fraiche\b/.test(name))return 'long-milk-cream';
 if(/\b(desserts?|puddings?|mousse|mousses|apple pies?|cherry pies?|mince pies?|cheesecakes?|trifles?|tiramisu|profiteroles?|eclairs?|custard|creme|crumble|tarts?|panna cotta|pots? au chocolat)\b/.test(name))return 'long-desserts';
 if(/\b(cream cheese|cheese|cheeses|cheddar|mozzarella|feta|halloumi|brie|camembert|parmesan|grana padano|gouda|edam|ricotta|mascarpone|stilton|red leicester)\b/.test(name)&&!meal.test(name)&&! /\b(ham|chicken|turkey|salami|meat|cauliflower|cauli)\b/.test(name))return 'long-cheese';
 if(/\b(milk|milkshakes?|milk shakes?|cream|creams|coffee drink|iced coffee|latte|cappuccino)\b/.test(name)&&!meal.test(name)&&!cookedMeat.test(name))return 'long-milk-cream';
 if(/\b(juices?|smoothies?|cold pressed)\b/.test(name))return 'long-juice';
 if(/\b(pizza|pizzas|garlic bread|garlic slices|garlic baguettes?|mixed breads)\b/.test(name))return 'long-pizza';
 const sauceOrSheets=/\b(pasta sauces?|pesto|carbonara sauce|bolognese sauce|lasagne sheets?)\b/.test(name);
 const pastaShape=/\b(tortell\w*|ravioli|gnocchi|tagliatelle|fettuccine|linguine|spaghetti|pappardelle)\b/.test(name);
 const preparedPasta=/\b(bakes?|tray ?bakes?|mac cheese|macaroni|ready meal|carbonara|bolognese|lasagne|lasagna)\b/.test(name);
 if(sauceOrSheets||((pastaShape||/\bfresh pasta\b/.test(name))&&!preparedPasta)||(/\bpasta\b/.test(name)&&!preparedPasta&&! /\b(chicken|bacon|beef|lamb|sausage|ham|salmon|prawns?)\b/.test(name)))return 'long-fresh-pasta';
 if(/\b(chorizo|salami|pepperoni|prosciutto|serrano|parma|pancetta|continental|rollitos?|kabanos|antipasti)\b/.test(name))return 'long-chorizo-salami';
 if(/\b(ham|deli|pastrami|brisket|corned beef|pate|pates|lunch tongue|meat selection|meat cheese|frankfurters?|meatballs|frikadellen|chicken|turkey|pork loin)\b/.test(name)&&!meal.test(name))return 'long-sandwich-meats';
 if(meal.test(name)||/\b(cottage|casserole|hotpot|stew|ready|gastro|cauliflower|cauli|gratin|dauphinoise|mash|mashed|chicken tomato|meal kit|fajita|enchilada)\b/.test(name))return 'long-ready-meals';
 return 'long-other';
}
/** Classify a product's walking stop without changing its catalogue area.
 * A manually assigned group wins over name-based rules.
 * @param {{section:string,name?:string,walking_group?:string|null}} product
 */
export function walkingGroup(product){
 const override=product.walking_group?groups.get(product.walking_group):undefined;
 if(override)return override;
 const kind=areaKind(product.section),name=normalise(product.name);
 let id;
 if(kind==='bread')id='bread';
 else if(kind==='chilled'||kind==='ambient')id=produceGroup(name)||(kind==='chilled'?'chilled-other':'ambient-other');
 else if(kind==='vegetarian'||(['short','long','food-to-go'].includes(kind)&&/\b(vegan|vegetarian|veggie|meat free|meatfree|meatless|plant based|plant menu|plantmenu|no chicken|no beef)\b/.test(name)))id='long-vegetarian-vegan';
 else if(kind==='food-to-go'||(['short','long'].includes(kind)&&/\b(sandwich\w*|wraps?|bloomers?|toasties?|sushi|onigiri|panini|pasta salad|salad bowl|salad pot|poke bowl|filled baguette|filled roll)\b/.test(name)&&! /\bsandwich (meats?|ham|chicken|slices|fillings?)\b/.test(name)))id='food-to-go';
 else if(kind==='short')id=shortLifeGroup(name);
 else if(kind==='long')id=longLifeGroup(name);
 return groups.get(id)||{id:'other',label:product.section,area:product.section,rank:WALKING_GROUPS.length};
}
/** Stable route ordering; neither the input nor the chosen set is changed.
 * @template {{section:string,name?:string,walking_group?:string|null}} T
 * @param {T[]} products
 * @returns {T[]}
 */
export function orderByArea(products){
 return products.map((product,index)=>({product,index,group:walkingGroup(product)}))
  .sort((a,b)=>a.group.rank-b.group.rank||(a.group.id==='other'?normalise(a.product.section).localeCompare(normalise(b.product.section)):0)||a.index-b.index)
  .map(({product})=>product);
}

/** @param {{section:string,name?:string,walking_group?:string|null}} product */
export function walkingLocation(product){
 const group=walkingGroup(product);
 return group.area===group.label?group.area:`${group.area} · ${group.label}`;
}
