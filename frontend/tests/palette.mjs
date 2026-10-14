import assert from 'node:assert/strict';

export async function assertMonochrome(page) {
  const colored = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap(element => {
    const style = getComputedStyle(element);
    return ['color', 'backgroundColor', 'borderTopColor', 'outlineColor'].flatMap(property => {
      const value = style[property];
      const rgb = value.match(/^rgba?\((\d+), (\d+), (\d+)/);
      return rgb && (rgb[1] !== rgb[2] || rgb[2] !== rgb[3]) ? [`${element.tagName}: ${property} ${value}`] : [];
    });
  }));
  assert.deepEqual(colored, [], 'The website must use black and white only.');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(0, 0, 0)');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).color), 'rgb(255, 255, 255)');
}
