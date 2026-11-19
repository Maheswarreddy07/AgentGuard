globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

// jsdom has no object URLs; file downloads in the app use them.
if (!URL.createObjectURL) { URL.createObjectURL = () => "blob:test"; URL.revokeObjectURL = () => {}; }
HTMLAnchorElement.prototype.click = HTMLAnchorElement.prototype.click ?? (() => {});
