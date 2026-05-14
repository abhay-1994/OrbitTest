const { test, expect } = require("orbittest");

test("BrowserStack demo login and add to bag", async (orbit) => {
  await orbit.open("https://bstackdemo.com/signin");
  const url= await orbit.url()
  const title=await orbit.title()
  console.log(title);
  
  console.log(url);
  
  await orbit.click(orbit.xpath("//div[text()='Select Username']"));
  await orbit.click(orbit.xpath("//div[text()='demouser']"));
  await orbit.click(orbit.xpath("//div[text()='Select Password']"));
  await orbit.click("testingisfun99");
  await orbit.click("Log In");
  expect(await orbit.exists("Products")).toBe(true);
  await orbit.waitFor(orbit.css(".shelf-item__title"), { timeout: 10000 });
  const products= await orbit.all(orbit.css(".shelf-item__title"))
  console.log("Product count:", products.length);
  for(const product of products){
    console.log(product.text);
    if(product.text=="iPhone XR"){
        await orbit.waitFor(orbit.nth(orbit.css(".shelf-item__buy-btn"), product.index))
        await orbit.click(orbit.nth(orbit.css(".shelf-item__buy-btn"), product.index))
        expect(await orbit.exists("Bag")).toBe(true)
        break;
    }
    
  }
});
