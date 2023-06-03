import "whatwg-fetch";
global.fetch = jest.fn();
performance.now = () => Date.now();
