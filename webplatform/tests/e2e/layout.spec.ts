import {test,expect} from '@playwright/test';

test('map legend labels remain clear of attribution across narrow viewports',async({page})=>{
  await page.goto('/?scenario=prepared-sample');
  await expect(page.getByRole('button',{name:'Add sensor',exact:true})).toBeEnabled();
  for(const [width,height] of [[1280,800],[768,1024],[390,844],[320,844]]){
    await page.setViewportSize({width,height});
    for(const label of ['Active fire','Burned ground']){
      const box=await page.getByText(label,{exact:true}).boundingBox();
      const attribution=await page.locator('.maplibregl-ctrl-attrib').boundingBox();
      expect(box).not.toBeNull();expect(attribution).not.toBeNull();
      const overlaps=box!.x<attribution!.x+attribution!.width&&box!.x+box!.width>attribution!.x&&box!.y<attribution!.y+attribution!.height&&box!.y+box!.height>attribution!.y;
      expect(overlaps,`${label} is obscured at${width}px`).toBe(false);
    }
    await page.screenshot({path:`output/playwright/legend-${width}.png`});
  }
});
