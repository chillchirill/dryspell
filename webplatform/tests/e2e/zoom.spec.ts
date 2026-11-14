import {test,expect,chromium} from '@playwright/test';
import {mkdir,mkdtemp} from 'node:fs/promises';

test('native Chrome 200 percent zoom keeps object tools and inspector reachable',async()=>{
  test.skip(process.platform!=='win32'&&!process.env.PLAYWRIGHT_CHANNEL,'Native Chrome settings require an installed Chrome channel.');
  await mkdir('data/private',{recursive:true});
  const profile=await mkdtemp('data/private/zoom-');
  const context=await chromium.launchPersistentContext(profile,{channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true,viewport:{width:1440,height:900},args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await context.newPage();
    await page.goto('chrome://settings/appearance');
    await page.evaluate(()=>new Promise<void>(resolve=>{
      const settings=(window as unknown as {chrome:{settingsPrivate:{setDefaultZoom:(factor:number,callback:()=>void)=>void}}}).chrome.settingsPrivate;
      settings.setDefaultZoom(2,resolve);
    }));
    await page.goto(process.env.BASE_URL||'http://127.0.0.1:4000');
    await expect(page.getByRole('button',{name:'Add sensor',exact:true})).toBeEnabled();
    const dimensions=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,scroll:document.documentElement.scrollWidth}));
    expect(dimensions.width).toBe(720);expect(dimensions.dpr).toBe(2);expect(dimensions.scroll).toBe(720);
    for(const name of ['Select objects','Add sensor','Add ignition','Inspect terrain','Open sensor list']){
      const button=page.getByRole('button',{name,exact:true});
      await expect(button).toBeVisible();
      expect(await button.evaluate(element=>{const box=element.getBoundingClientRect();return document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('button')===element;})).toBe(true);
    }
    await page.screenshot({path:'output/playwright/12-native-zoom-200.png'});
    await page.getByRole('button',{name:'Open sensor list',exact:true}).click();
    await expect(page.getByRole('button',{name:'Close inspector',exact:true})).toBeVisible();
    await page.screenshot({path:'output/playwright/13-native-zoom-inspector.png'});
    await page.getByRole('button',{name:'Close inspector',exact:true}).click();
  }finally{await context.close();}
});
