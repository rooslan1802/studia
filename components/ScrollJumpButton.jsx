import React, { useEffect, useState } from 'react';

function getTarget() {
  const candidates = [
    document.querySelector('.children-list-wrap'),
    document.querySelector('.modal'),
    document.querySelector('.content'),
    document.scrollingElement || document.documentElement
  ].filter(Boolean);

  let best = candidates[candidates.length - 1] || document.documentElement;
  let bestDelta = 0;
  candidates.forEach((node) => {
    const delta = Math.max(0, (node.scrollHeight || 0) - (node.clientHeight || window.innerHeight));
    if (delta > bestDelta + 30) {
      best = node;
      bestDelta = delta;
    }
  });
  return best;
}

function getScrollState() {
  const target = getTarget();
  const scrollTop = target.scrollTop || 0;
  const viewport = target.clientHeight || window.innerHeight;
  const scrollHeight = target.scrollHeight || document.documentElement.scrollHeight;
  const canScroll = scrollHeight > viewport + 120;
  const nearBottom = scrollTop + viewport >= scrollHeight - 80;
  return { canScroll, nearBottom, target };
}

export default function ScrollJumpButton() {
  const [state, setState] = useState(() => getScrollState());

  useEffect(() => {
    function recalc() {
      setState(getScrollState());
    }

    recalc();
    window.addEventListener('scroll', recalc, { passive: true });
    window.addEventListener('resize', recalc);
    const timer = window.setInterval(recalc, 700);
    const content = document.querySelector('.content');
    const childrenList = document.querySelector('.children-list-wrap');
    content?.addEventListener('scroll', recalc, { passive: true });
    childrenList?.addEventListener('scroll', recalc, { passive: true });
    return () => {
      window.removeEventListener('scroll', recalc);
      window.removeEventListener('resize', recalc);
      window.clearInterval(timer);
      content?.removeEventListener('scroll', recalc);
      childrenList?.removeEventListener('scroll', recalc);
    };
  }, []);

  if (!state.canScroll) return null;

  const isBottom = state.nearBottom;
  const title = isBottom ? 'Наверх' : 'Вниз';
  const icon = isBottom ? '↑' : '↓';

  return (
    <button
      className="scroll-jump-btn"
      title={title}
      aria-label={title}
      onClick={() => {
        const target = state.target || document.documentElement;
        target.scrollTo({
          top: isBottom ? 0 : target.scrollHeight,
          behavior: 'smooth'
        });
      }}
    >
      <span className="scroll-jump-icon">{icon}</span>
    </button>
  );
}
