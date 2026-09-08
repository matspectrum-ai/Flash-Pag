(() => {
  if (typeof window.sectionIntro === 'function') return;

  window.sectionIntro = function(title, copy, actions) {
    const wrap = node('div', undefined, 'section-intro');
    const left = node('div');
    left.append(node('h2', title), node('p', copy));
    wrap.append(left);
    if (actions) wrap.append(actions);
    return wrap;
  };
})();
