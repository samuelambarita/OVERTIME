const PAGE_SIZE = 25;
const MAX_PAGE = 100000;

function pageParams(page) {
  let p = Math.floor(Number(page));
  if (!Number.isFinite(p) || p < 1) p = 1;
  if (p > MAX_PAGE) p = MAX_PAGE;
  return { page: p, limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE };
}

module.exports = { PAGE_SIZE, pageParams };
