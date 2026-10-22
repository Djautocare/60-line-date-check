import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {handle} from '../server/service.mjs';
import {walkingGroup,orderByArea,WALKING_GROUPS} from '../shared/area-order.mjs';
import {parseCatalogueCSV} from '../src/catalogue-csv.mjs';
import {selectDailyProducts,selectProducts} from '../server/selection.mjs';

const examples=[
 ['bread','Bread',['SS Tinned Protein Sourdough','Traditional Seeded Bloomer','Plain Tortilla Wraps','Garlic & Herb Panini Rolls']],
 ['food-to-go','Short life',['Chicken & Bacon Sandwich','Chicken Bloomer','Chicken Wrap','Winter Toastie','Pasta Salad Pot','Sushi Selection']],
 ['chilled-prepared-fruit','Chilled produce',['Classic Fruit Salad 200g e','Pineapple Chunks 300g','Mango Chunks 240g','Apple & Grape Snack 80g','Pomegranate Seeds 200g','Melon Mango & Pineapple Fingers 240g','Melon Medley 300g','Fans Watermelon 300g','Watermelon Wedges']],
 ['chilled-grapes','Chilled produce',['VAL Grapes 500g','Grapes Snack Pack Seedless 200g','PREM Cotton Candy Grapes 400g e']],
 ['chilled-berries','Chilled produce',['VAL Blueberries 125g e','Blackberries 150g e','PREM Strawberries 227g e','Raspberries 225g e']],
 ['chilled-whole-fruit','Chilled produce',['Plums 1kg','Plum 400g','Peaches 4pk']],
 ['chilled-salads','Chilled produce',['WSR Salad 80g e','Caesar Salad Kit 200g','Rocket & Babyleaf Salad 90g e','Peashoot/Butterhead 80g','Chopped Iceberg 200g e','Little Gem Lettuce 2pk','Spring Onions 100g']],
 ['chilled-prepared-veg','Chilled produce',['Layered Vegetables 240g','Cauli & Broc Florets 400g e','Carrot Batons 400g e','Diced Onion 200g','Crispy Potato Slices 350g e','Prep Baby Potatoes 385g e','Med Veg Medley 400g e']],
 ['chilled-other-veg','Chilled produce',['PREM Extra Fine Beans 220g','Beansprouts 400g e','Green Asparagus Tips 100g','Broccoli 360g e','Sweetheart (Pointed) Cabbage']],
 ['chilled-stir-fry','Chilled produce',['Large Stir Fry Bag 600g e','SF SAUCES TERI/CM/LGRS 175G','SF Sauces SC/P&H/Kat 175g','SF Edamame/ Mushroom 320g','SF Oriental/Pepper 320g','Egg Noodles 410g e','Protein Noodles 300g','Sngpre/Rce Noodle 300g']],
 ['chilled-mushrooms','Chilled produce',['Sliced Mushrooms 250g e','VAL Mushrooms 650g e','Large Flat Mushrooms 250g e','Chestnut Mushrooms 250g e']],
 ['chilled-herbs','Chilled produce',['Cut Coriander 30g','Cut Mint 30g','Cut Parsley 30g','Cut Rosemary 20g','Cut Thyme 20g']],
 ['ambient-potatoes','Ambient produce',['Miniature Potatoes 500g e','Sweet Potato Each','Red Rooster Potatoes 2kg e','Maris Piper Potatoes 2.5kg e','Baking Potatoes 4pk']],
 ['ambient-roots','Ambient produce',['Organic Carrots 700g','Butternut Squash Each','Munchkin Pumpkin Each','Mixed Squash Each','White Garlic 4pk','Ginger 125g','Beetroot 500g','VAL Parsnips 500g e']],
 ['ambient-onions','Ambient produce',['Extra Large Mild Onions 3pk','Red Onions 1kg e','Shallots 400g e']],
 ['ambient-peppers','Ambient produce',['Snack Pepper 250g','Scotch Bonnet/Finger Chilli 50/80g','VAL Family Pack Peppers 600g','Sweet Mixed Peppers 3pk']],
 ['ambient-tomatoes','Ambient produce',['Baby Plum Tomatoes 500g','Cherry Tomatoes 330g','PREM Piccolato Tomatoes 400g']],
 ['ambient-bananas','Ambient produce',['ORG FT Bananas 6pk','Midi Bananas 7pk','Banana Each']],
 ['ambient-pineapples','Ambient produce',['Crownless Pineapple Each']],
 ['ambient-melons','Ambient produce',['Mini Watermelon Each','Honeydew Each','Galia Each']],
 ['ambient-exotic-fruit','Ambient produce',['Avocado 2pk','Mango Each','PREM Gold Kiwi 3pk','Figs 140g']],
 ['ambient-citrus','Ambient produce',['Oranges 5pk','VAL Easy Peelers 600g e','Grapefruit Each','Lemons 500g','Limes 5pk']],
 ['ambient-apples','Ambient produce',['Pink Lady Apples 6pk','Braeburn Apples 6pk','British Apples 6pk','Toffee/Choc Apple Each']],
 ['ambient-pears','Ambient produce',['Conference Pear 610g','Seasonal Pears 610g e','Mini Pears 550g e']],
 ['ambient-aubergines','Ambient produce',['Aubergine each','Courgettes 500g']],
 ['ambient-cucumbers','Ambient produce',['Baby Snack Cucumber 200g','Cucumber Each']],
 ['short-chicken','Short life',['Chicken Breast Fillets','Diced Chicken Breast','Whole Chicken','Chicken Thighs']],
 ['short-turkey','Short life',['Turkey Breast Steaks','Turkey Mince']],
 ['short-beef-lamb','Short life',['British Beef Mince 5%','Lamb Leg Steaks','Beef Topside Joint']],
 ['short-pork-gammon','Short life',['Pork Loin Steaks','Gammon Joint']],
 ['short-bacon','Short life',['Back Bacon','Smoked Bacon Rashers','Sliced Smoked Bacon','NAW Back Bacon']],
 ['short-sausages','Short life',['Pork Sausages','Chicken Sausages','Chipolatas','Pigs in Blankets']],
 ['short-fish','Short life',['Salmon Fillets','Sliced Smoked Salmon','Cod Fillets','Cooked Prawns']],
 ['short-other','Short life',['Gastro Lasagne 400G','NAW Chicken/Turkey 120g','Chicken D/Sticks/Thighs Forresters','Gastro Butter Chicken/ Prawn Bhuna','Chicken Korma / Rogan Jos']],
 ['long-pastries-pies','Long life',['Yorkshire Puddings','Steak Pie','Cheese & Onion Pasties','Salmon Lattice']],
 ['long-quiche','Long life',['Quiche Lorraine','Cheese & Onion Quiche']],
 ['long-dips-salads','Long life',['SS Coleslaw 300g','Potato Salad','Houmous','Sour Cream & Chive Dip']],
 ['long-sausage-rolls','Long life',['S/S Sausage Rolls','Mini Sausage Rolls']],
 ['long-satay','Long life',['Chicken Satay Skewers','Sweet Chilli Chicken Skewers']],
 ['long-butter-dough','Long life',['Salted Butter','Spreadable Butter','Sunflower Spread','Puff Pastry','Cookie Dough']],
 ['long-protein-dairy','Long life',['Protein Yoghurt','Protein Pudding','Protein Dessert','Skyr','Quark']],
 ['long-yoghurts','Long life',['Greek Style Natural Yoghurt','Kids Yoghurts','Fromage Frais']],
 ['long-desserts','Long life',['Chocolate Mousse','Cheesecake','Ricotta Cheesecake','Sticky Toffee Pudding','Apple Pie','Custard']],
 ['long-milk-cream','Long life',['Creme Fraiche','Single Cream 300ml','Double Cream 300ml','Coffee Drink Mix 250ml','Whole Milk','Chocolate Milkshake']],
 ['long-cheese','Long life',['Sliced Cheddar','Cream Cheese','Mozzarella','Halloumi','Garlic & Herb Soft Cheese']],
 ['long-juice','Long life',['Cold Pressed Juices 600ml','Kids Smoothies 4x150ml','Orange Juice']],
 ['long-vegetarian-vegan','Short life',['Vegan Sandwich','Plant Menu Sausages','Meat Free Burgers','Vegetarian Lasagne','No Chicken Pieces']],
 ['long-ready-meals','Long life',['Lasagne 1kg','Chicken Tikka Masala','Mac & Cheese / Chorizo Mac & Cheese','Cottage Pie 1.2kg','Carbonara Family Traybake Chicken Tomato','Chicken Pasta Bake','Chicken Pasta 400g','Gastro Mashed Potato','Cauliflower Cheese','Butter Basted Chicken']],
 ['long-fresh-pasta','Long life',['Fresh Pasta','Spinach & Ricotta Ravioli','Chicken & Bacon Tortelloni','Lasagne Sheets','Pasta Sauce','Bolognese Sauce','Pesto']],
 ['long-pizza','Long life',['Cheese & Tom Pizza 10inch','Cheese & Tomato Pizza 6.5','Garlic Slices','Mixed Breads','Twin Pack Garlic Baguette']],
 ['long-sandwich-meats','Long life',['Finely Sliced SS Ham 200g','Deli Ham','S/S Wafer Thin Ham Cooked/Honey 120g','BBQ Brisket/ Pastrami','Pork Lunch Tongue','British Cooked/Smoked Ham','Corned Beef 175g','Pates Topped 170g','Sliced Cooked Chicken','Sandwich Meat Selection']],
 ['long-chorizo-salami','Long life',['Spanish Chorizo Ring 200g','Prosciutto di Parma DOP 80g','German/Peppered Salami','Salami & Cheese','Italian Style Pepperoni (ZMI)','Diced Pancetta 2x100g','Kabanos 120g']],
];

test('walking groups follow the agreed route for catalogue descriptions and mixed cases',()=>{
 const mismatches=[];for(const [expected,section,names] of examples)for(const name of names){const actual=walkingGroup({section,name}).id;if(actual!==expected)mismatches.push({name,section,expected,actual});}assert.deepEqual(mismatches,[]);
 const route=examples.map(([id,section,[name]])=>({id,section,name}));
 assert.deepEqual(orderByArea([...route].reverse()).map(p=>p.id),route.map(p=>p.id));
});
test('walking order is stable, accepts explicit corrections and preserves exact allocation and selection',()=>{
 const foods=Array.from({length:70},(_,i)=>({id:String(i),section:i%2?'Short life':'Long life',name:i%3?'Vegan Sausages':'Chicken Wrap',risk:i%2?'high':'low'}));
 const counts={'Short life':30,'Long life':30},chosen=selectDailyProducts(foods,counts,()=>.5);
 assert.equal(chosen.filter(p=>p.section==='Short life').length,30);assert.equal(chosen.filter(p=>p.section==='Long life').length,30);
 assert.equal(new Set(chosen.map(p=>p.id)).size,60);
 assert.deepEqual(selectDailyProducts(foods,null,()=>.5),orderByArea(selectProducts(foods,60,()=>.5)));
 const input=[{section:'Bread',name:'Bread A'},{section:'Short life',name:'Chicken Wrap',walking_group:'short-other'},{section:'Bread',name:'Bread B'}],copy=structuredClone(input);
 assert.deepEqual(orderByArea(input).map(p=>p.name),['Bread A','Bread B','Chicken Wrap']);assert.deepEqual(input,copy);
 assert.equal(walkingGroup({section:'Long life',name:'Vegan Yoghurt',walking_group:'long-yoghurts'}).id,'long-yoghurts');
 assert.equal(walkingGroup({section:'Bread',name:'Cheddar',walking_group:'bad-group'}).id,'bread');
 assert.equal(walkingGroup({section:'Unknown area',name:'Creamy Chicken Wrap'}).id,'other');
 // Produce stops are based on the physical route while their original quotas stay intact.
 assert.equal(walkingGroup({section:'Chilled produce',name:'Carrots 1kg'}).id,'ambient-roots');
 assert.equal(walkingGroup({section:'Chilled produce',name:'British Apples 6pk'}).id,'ambient-apples');
 assert.equal(walkingGroup({section:'Ambient produce',name:'Cut Basil 30g'}).id,'chilled-herbs');
 assert.equal(new Set(WALKING_GROUPS.map(g=>g.id)).size,WALKING_GROUPS.length);
});

test('walking positions save, clear and snapshot without changing permissions, quotas or old reports',async()=>{
 const engine=new PGlite();await engine.waitReady;const db=await openDatabase('test',{pool:{query:(q,a)=>engine.query(q,a),connect:async()=>({query:(q,a)=>engine.query(q,a),release(){}}),end:()=>engine.close()}});
 const call=async(path,body,user='owner')=>{const response=await handle(new Request('http://localhost/api/'+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})}),db,{id:user});return {status:response.status,data:await response.json()};};
 try{
  for(const [id,role] of [['owner','admin'],['admin','admin'],['staff','staff']])await db.prepare('INSERT INTO members(id,username,name,role,password_hash,created) VALUES(?,?,?,?,?,?)').bind(id,id,id,role,'unused','2026-10-01').run();
  await db.prepare("INSERT INTO settings(key,value) VALUES('owner','owner')").run();
  assert.equal((await call('products',{items:Array.from({length:60},(_,i)=>({name:i?'Bread '+i:'Ambiguous mixed case',plu:String(100000+i),section:'Bread',walking_group:i?null:'long-vegetarian-vegan'}))})).status,200);
  let product=(await call('state')).data.products.find(p=>p.plu==='100000');assert.equal(product.walking_group,'long-vegetarian-vegan');
  assert.equal((await call('products',{...product,walking_group:'not-real'},'admin')).status,400);
  assert.equal((await call('products',{...product,walking_group:'food-to-go'},'staff')).status,403);
  assert.equal((await call('products',{...product,walking_group:'food-to-go'},'admin')).status,200);
  const started=(await call('rounds/start',{},'staff')).data;assert.equal(started.lines.length,60);assert.equal(started.lines.at(-1).name,product.name);assert.equal(started.lines.at(-1).walking_group,'food-to-go');assert.equal(started.lines.at(-1).section,'Bread');
  const ids=started.lines.map(l=>l.id);
  // Existing imports that omit this new field preserve an explicit correction.
  assert.equal((await call('products',{items:[{name:product.name,plu:product.plu,section:'Bread'}]})).status,200);
  product=(await call('state')).data.products.find(p=>p.id===product.id);assert.equal(product.walking_group,'food-to-go');
  assert.equal((await call('products',{...product,walking_group:null},'admin')).status,200);
  assert.equal((await call('state')).data.products.find(p=>p.id===product.id).walking_group,null);
  const report=(await call('report/'+encodeURIComponent(started.round.id))).data;
  assert.deepEqual(report.lines.map(l=>l.id),ids);assert.equal(report.lines.at(-1).walking_group,'food-to-go');
  const practice=(await call('rounds/start',{mode:'practice'},'admin')).data;assert.ok(practice.lines.every(l=>l.walking_group===null));
 }finally{await db.close();}
});

test('catalogue CSV round-trips optional walking positions and preserves old CSV shapes',()=>{
 assert.deepEqual(parseCatalogueCSV('name,plu,area,walking_group\nMixed case,001234,Short life,food-to-go'),[{name:'Mixed case',plu:'001234',section:'Short life',walking_group:'food-to-go'}]);
 assert.deepEqual(parseCatalogueCSV('name,plu,area,walking_group\nBread,001234,Bread,'),[{name:'Bread',plu:'001234',section:'Bread',walking_group:null}]);
 assert.deepEqual(parseCatalogueCSV('name,plu,area\nBread,001234,Bread'),[{name:'Bread',plu:'001234',section:'Bread'}]);
 assert.throws(()=>parseCatalogueCSV('name,plu,area,walking_group\nBread,001234,Bread,wrong'),/walking_group/);
});
