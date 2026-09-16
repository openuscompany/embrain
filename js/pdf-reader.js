(function () {
  // 페이지 이미지가 들어있는 폴더와 장수. 파일명은 page-001.jpg ~ page-0NN.jpg 형식이어야 한다.
  // 다른 호로 교체할 때는 PAGE_FOLDER/PAGE_COUNT와 아래 CHAPTERS만 새 자료에 맞게 바꾸면 된다.
  var PAGE_FOLDER = 'pages';
  var PAGE_COUNT = 96;

  function pageUrl(pageNumber) {
    var padded = ('000' + pageNumber).slice(-3);
    return PAGE_FOLDER + '/page-' + padded + '.jpg';
  }

  // PC/모바일 여부 판단 기준을 여기 한 곳에 모아둔다. 뷰포트 폭(CSS 픽셀) 대신
  // window.screen.width(모니터 자체의 물리 크기)를 쓰는 이유는 sizeBookToStage()의
  // 페이지 모드 판단과 동일 — 브라우저 자체 확대(Ctrl+휠 등)에 영향받지 않아야
  // PC에서 확대해도 모바일 레이아웃(한 페이지 모드, 목차 상단 배치)으로 잘못
  // 바뀌지 않는다. 목차 위치(오른쪽/위쪽)도 이 기준을 그대로 따라간다.
  function isMobileLayout() {
    return window.screen.width < 640;
  }

  // 목차 탭에 표시할 챕터 목록. 다른 자료로 교체할 때는 이 배열도 그 자료의 목차에 맞게 수정하세요.
  // page: 그 챕터가 시작하는 실제 이미지 페이지 번호(1부터 시작). color: 탭 배경(파스텔 톤), textColor: 탭 글자색.
  var CHAPTERS = [
    { title: "'영점소비'\n시대", page: 10, color: '#cdd3f7', textColor: '#3d4a9e' },
    { title: '1. 마이-파이', page: 31, color: '#c9ead9', textColor: '#2f8a5b' },
    { title: '2. 언클리셰', page: 45, color: '#cdeaf3', textColor: '#1f7c9c' },
    { title: '3. BPM\n이코노미', page: 59, color: '#f6d3e2', textColor: '#b1447a' },
    { title: '4. 스탯 맥싱', page: 71, color: '#ddd6f7', textColor: '#6249c7' },
    { title: '영점 조준의\n시대', page: 79, color: '#cdd3f7', textColor: '#3d4a9e' }
  ];

  // 모바일 브라우저(특히 카카오톡 등 인앱 브라우저)는 100dvh를 지원 안 하거나 주소창이
  // 나타날 때 실제 화면 높이가 바뀌는데, CSS만으로는 못 잡는 경우가 있어 JS로 실제
  // window.innerHeight를 --vh 변수로 계속 갱신해서 css의 calc(var(--vh)*100)이 쓰게 한다.
  (function setupViewportHeightVar() {
    function update() {
      document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', update);
    }
  })();

  var stage = document.getElementById('pr-stage');
  var bookEl = document.getElementById('pr-book');
  var loadingEl = document.getElementById('pr-loading');
  var hintEl = document.getElementById('pr-hint');
  var firstBtn = document.getElementById('pr-first');
  var prevBtn = document.getElementById('pr-prev');
  var nextBtn = document.getElementById('pr-next');
  var lastBtn = document.getElementById('pr-last');
  var currentEl = document.querySelector('.pr-indicator__current');
  var totalEl = document.querySelector('.pr-indicator__total');
  var indexRail = document.getElementById('pr-index-rail');
  var bookCropEl = document.getElementById('pr-book-crop');
  var pageJumpBtn = document.getElementById('pr-page-jump-btn');
  var pageJumpInput = document.getElementById('pr-page-jump-input');

  // 테마 전환 (밝은 모드 / 다크 모드). 책 페이지 이미지 자체는 그대로 두고
  // 주변 화면 색상만 바뀐다. 선택한 테마는 localStorage에 저장해서 다음 방문에도 유지한다.
  (function initThemeSwitcher() {
    var THEME_KEY = 'pr-theme';
    var switcherEl = document.getElementById('pr-theme-switcher');
    if (!switcherEl) return;
    var buttons = switcherEl.querySelectorAll('.pr-theme-btn');

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme', theme);
      buttons.forEach(function (btn) {
        btn.classList.toggle('is-active', btn.dataset.theme === theme);
      });
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 저장 불가 시 무시 */ }
    }

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyTheme(btn.dataset.theme);
      });
    });

    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* 무시 */ }
    applyTheme(saved || 'light');
  })();

  if (!stage || !bookEl) {
    showError('이북을 불러오지 못했어요. 새로고침해 주세요.');
    return;
  }

  function showError(message) {
    if (loadingEl) loadingEl.classList.add('is-hidden');
    var err = document.createElement('div');
    err.className = 'pr-error';
    err.textContent = message;
    stage.appendChild(err);
  }

  // 책 한 페이지의 화면 표시 크기(px)를 계산한다. St.PageFlip을 쓸 때는 라이브러리가
  // 자체적으로 스프레드/포트레이트 여부를 판단하느라 minWidth/maxWidth 같은 힌트가
  // 필요했는데, 이제는 우리가 직접 DOM 크기를 정하므로 훨씬 단순해졌다.
  function sizeBookToStage(aspect) {
    var stageRect = stage.getBoundingClientRect();
    var mobileLayout = isMobileLayout();
    // 목차가 PC에서는 책 오른쪽 가장자리에, 모바일에서는 책 위쪽에 붙어서 따라다니므로,
    // 책 크기를 계산할 때 그만큼 미리 비워둬서 화면 밖으로 넘치거나 겹치지 않게 한다.
    var railWidth = (!mobileLayout && indexRail && indexRail.offsetWidth) || 0;
    var railHeight = (mobileLayout && indexRail && indexRail.offsetHeight) || 0;
    stage.style.paddingRight = mobileLayout ? '16px' : (16 + railWidth + 6) + 'px';
    stage.style.paddingTop = mobileLayout ? (16 + railHeight + 6) + 'px' : '16px';
    var availW = Math.max(200, stageRect.width - 32 - railWidth);
    var availH = Math.max(200, stageRect.height - 32 - railHeight);

    // 두 페이지가 나란히 펼쳐지는 스프레드 기준으로 한 페이지 폭을 계산
    var pageW = Math.min(availW / 2, availH * aspect);
    if (mobileLayout) {
      // 화면이 좁으면 한 페이지만 보이는 모드에 맞춰 폭을 계산
      pageW = Math.min(availW, availH * aspect);
    }
    var pageH = pageW / aspect;

    // Windows 디스플레이 배율이 125%/150%처럼 정수가 아니면, 책 크기가 CSS 픽셀
    // 기준으로는 딱 맞아떨어져도 실제 모니터의 물리 픽셀 격자에는 어긋나서 화면에
    // 그릴 때 미세하게 번져 보인다. 실제 배율(devicePixelRatio)을 기준으로 물리
    // 픽셀 경계에 딱 맞는 CSS 크기로 반올림해서 이 흐림을 줄인다.
    var realDpr = window.devicePixelRatio || 1;
    var width = Math.round(pageW * realDpr) / realDpr;
    var height = Math.round(pageH * realDpr) / realDpr;

    return { width: width, height: height };
  }

  // 목차 탭을 책의 실제 오른쪽 가장자리에 붙여서 위치시킨다. 화면(stage) 기준
  // 절대 좌표가 아니라 책(book-crop)의 현재 위치를 매번 다시 측정해서 따라가게
  // 하므로, 책이 화면 중앙에서 벗어나 있거나 확대/축소·앞뒤 표지로 크기가
  // 바뀌어도 항상 책 옆에 붙어 있다.
  function positionIndexRail() {
    if (!indexRail || !bookCropEl || !stage) return;
    var stageRect = stage.getBoundingClientRect();
    var cropRect = bookCropEl.getBoundingClientRect();
    var mobileLayout = isMobileLayout();
    indexRail.classList.toggle('pr-index-rail--top', mobileLayout);

    if (mobileLayout) {
      // 모바일은 화면이 좁아 책 오른쪽에 붙일 자리가 없으므로, 책 위쪽에
      // 가로로 눕혀 붙인다. 책 폭에 맞춰 탭이 균등하게 나뉘도록 rail 폭도
      // 책 폭에 맞춘다.
      indexRail.style.width = cropRect.width + 'px';
      var leftTop = Math.max(8, cropRect.left - stageRect.left + stage.scrollLeft);
      indexRail.style.left = leftTop + 'px';
      var topTop = Math.max(8, cropRect.top - stageRect.top + stage.scrollTop - indexRail.offsetHeight);
      indexRail.style.top = topTop + 'px';
      return;
    }

    indexRail.style.width = '';
    var left = Math.max(8, cropRect.right - stageRect.left + stage.scrollLeft);
    indexRail.style.left = left + 'px';
    var top = Math.max(8, cropRect.top - stageRect.top + stage.scrollTop);
    indexRail.style.top = top + 'px';
  }

  // --- 확대/축소 ---
  var zoomLevel = 1;
  var ZOOM_MIN = 1;
  var ZOOM_MAX = 2;
  var ZOOM_STEP = 0.25;
  var zoomInBtn = document.getElementById('pr-zoom-in');
  var zoomOutBtn = document.getElementById('pr-zoom-out');
  var zoomLevelEl = document.getElementById('pr-zoom-level');
  var zoomAnchor = null;

  function captureZoomAnchor() {
    if (!stage || !bookCropEl) { zoomAnchor = null; return; }
    var stageRect = stage.getBoundingClientRect();
    var cropRect = bookCropEl.getBoundingClientRect();
    var viewportCenterX = stageRect.left + stageRect.width / 2;
    var viewportCenterY = stageRect.top + stageRect.height / 2;
    zoomAnchor = {
      x: (viewportCenterX - cropRect.left) / zoomLevel,
      y: (viewportCenterY - cropRect.top) / zoomLevel
    };
  }

  function applyZoomAnchor() {
    if (!zoomAnchor || !stage || !bookCropEl) { zoomAnchor = null; return; }
    if (zoomLevel > 1) {
      var stageRect = stage.getBoundingClientRect();
      var cropRect = bookCropEl.getBoundingClientRect();
      var viewportCenterX = stageRect.left + stageRect.width / 2;
      var viewportCenterY = stageRect.top + stageRect.height / 2;
      var currentAnchorX = cropRect.left + zoomAnchor.x * zoomLevel;
      var currentAnchorY = cropRect.top + zoomAnchor.y * zoomLevel;
      stage.scrollLeft += currentAnchorX - viewportCenterX;
      stage.scrollTop += currentAnchorY - viewportCenterY;
    }
    zoomAnchor = null;
  }

  function applyZoom() {
    if (bookCropEl) bookCropEl.style.transform = 'scale(' + zoomLevel + ')';
    if (zoomLevelEl) zoomLevelEl.textContent = Math.round(zoomLevel * 100) + '%';
    if (stage) stage.classList.toggle('is-zoomed', zoomLevel > 1);
    positionIndexRail();
  }

  function scheduleZoomAnchorFallback() {
    setTimeout(function () {
      applyZoomAnchor();
      positionIndexRail();
    }, 260);
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', function () {
      var nextLevel = Math.min(ZOOM_MAX, Math.round((zoomLevel + ZOOM_STEP) * 100) / 100);
      if (nextLevel === zoomLevel) return;
      captureZoomAnchor();
      zoomLevel = nextLevel;
      applyZoom();
      scheduleZoomAnchorFallback();
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', function () {
      var nextLevel = Math.max(ZOOM_MIN, Math.round((zoomLevel - ZOOM_STEP) * 100) / 100);
      if (nextLevel === zoomLevel) return;
      captureZoomAnchor();
      zoomLevel = nextLevel;
      applyZoom();
      scheduleZoomAnchorFallback();
    });
  }

  if (bookCropEl) {
    bookCropEl.addEventListener('transitionend', function (event) {
      if (event.propertyName === 'transform') {
        applyZoomAnchor();
        positionIndexRail();
      }
    });
  }

  // --- 책갈피 (책에 직접 꽂힌 리본처럼 표시 + 좌상단 패널에서 목록으로 모아보기) ---
  var BOOKMARK_KEY = 'pr-bookmarks';
  var bookmarkBtn = document.getElementById('pr-bookmark-btn');
  var bookmarkRibbon = document.getElementById('pr-bookmark-ribbon');
  var bookmarkPanel = document.getElementById('pr-bookmark-panel');
  var bookmarkToggleBtn = document.getElementById('pr-bookmark-toggle');
  var bookmarkListEl = document.getElementById('pr-bookmark-list');
  var bookmarkEmptyEl = document.getElementById('pr-bookmark-empty');
  var bookmarks = [];
  try { bookmarks = JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]'); } catch (e) { bookmarks = []; }

  function saveBookmarks() {
    try { localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks)); } catch (e) { /* 저장 불가 시 무시 */ }
  }

  function updateBookmarkUI(pageIndex) {
    var marked = bookmarks.indexOf(pageIndex) !== -1;
    if (bookmarkBtn) bookmarkBtn.classList.toggle('is-active', marked);
    if (bookmarkRibbon) bookmarkRibbon.hidden = !marked;
    if (bookmarkToggleBtn) {
      bookmarkToggleBtn.textContent = marked ? '🔖 이 페이지 책갈피 삭제' : '🔖 이 페이지 책갈피 추가';
      bookmarkToggleBtn.classList.toggle('is-active', marked);
    }
  }

  function renderBookmarkList() {
    if (!bookmarkListEl) return;
    var old = bookmarkListEl.querySelectorAll('.pr-panel-item');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);

    var sorted = bookmarks.slice().sort(function (a, b) { return a - b; });
    if (bookmarkEmptyEl) bookmarkEmptyEl.hidden = sorted.length > 0;

    sorted.forEach(function (pageIndex) {
      var item = document.createElement('div');
      item.className = 'pr-panel-item';

      var jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'pr-panel-item__jump';
      jumpBtn.innerHTML = '<span class="pr-panel-item__page">' + (pageIndex + 1) + '쪽</span>';
      jumpBtn.setAttribute('aria-label', (pageIndex + 1) + '쪽 책갈피로 이동');
      jumpBtn.addEventListener('click', function () {
        book.turnToPage(pageIndex);
        hideHintOnce();
        closeBookmarkPanel();
      });

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'pr-panel-item__delete';
      deleteBtn.textContent = '✕';
      deleteBtn.setAttribute('aria-label', (pageIndex + 1) + '쪽 책갈피 삭제');
      deleteBtn.addEventListener('click', function () {
        var pos = bookmarks.indexOf(pageIndex);
        if (pos !== -1) bookmarks.splice(pos, 1);
        saveBookmarks();
        if (book.currentIndex === pageIndex) updateBookmarkUI(pageIndex);
        renderBookmarkList();
      });

      item.appendChild(jumpBtn);
      item.appendChild(deleteBtn);
      bookmarkListEl.appendChild(item);
    });
  }

  function openBookmarkPanel() {
    if (!bookmarkPanel) return;
    if (memoPanel && !memoPanel.hidden) closeMemoPanel();
    renderBookmarkList();
    bookmarkPanel.hidden = false;
  }

  function closeBookmarkPanel() {
    if (bookmarkPanel) bookmarkPanel.hidden = true;
  }

  function toggleBookmarkPanel() {
    if (!bookmarkPanel) return;
    if (bookmarkPanel.hidden) openBookmarkPanel(); else closeBookmarkPanel();
  }

  if (bookmarkBtn) bookmarkBtn.addEventListener('click', toggleBookmarkPanel);

  if (bookmarkToggleBtn) {
    bookmarkToggleBtn.addEventListener('click', function () {
      var pageIndex = book.currentIndex;
      var pos = bookmarks.indexOf(pageIndex);
      if (pos === -1) bookmarks.push(pageIndex); else bookmarks.splice(pos, 1);
      saveBookmarks();
      updateBookmarkUI(pageIndex);
      renderBookmarkList();
    });
  }

  // --- 메모 (좌상단 패널에서 현재 페이지 작성 + 전체 목록 모아보기) ---
  var MEMO_KEY = 'pr-memos';
  var memoBtn = document.getElementById('pr-memo-btn');
  var memoPanel = document.getElementById('pr-memo-panel');
  var memoTextarea = document.getElementById('pr-memo-textarea');
  var memoCloseBtn = document.getElementById('pr-memo-close');
  var memoListHeadEl = document.getElementById('pr-memo-listhead');
  var memoListEl = document.getElementById('pr-memo-list');
  var memoEmptyEl = document.getElementById('pr-memo-empty');
  var memoOpenPageIndex = null;
  var memos = {};
  try { memos = JSON.parse(localStorage.getItem(MEMO_KEY) || '{}'); } catch (e) { memos = {}; }

  function saveMemos() {
    try { localStorage.setItem(MEMO_KEY, JSON.stringify(memos)); } catch (e) { /* 저장 불가 시 무시 */ }
  }

  function updateMemoUI(pageIndex) {
    var hasMemo = !!(memos[pageIndex] && String(memos[pageIndex]).trim());
    if (memoBtn) memoBtn.classList.toggle('is-active', hasMemo);
  }

  function renderMemoList() {
    if (!memoListEl) return;
    var old = memoListEl.querySelectorAll('.pr-panel-item');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);

    var pageIndexes = Object.keys(memos)
      .filter(function (key) { return memos[key] && String(memos[key]).trim(); })
      .map(Number)
      .sort(function (a, b) { return a - b; });

    if (memoEmptyEl) memoEmptyEl.hidden = pageIndexes.length > 0;
    if (memoListHeadEl) memoListHeadEl.hidden = pageIndexes.length === 0;

    pageIndexes.forEach(function (pageIndex) {
      var item = document.createElement('div');
      item.className = 'pr-panel-item';

      var jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'pr-panel-item__jump';
      jumpBtn.innerHTML = '<span class="pr-panel-item__page">' + (pageIndex + 1) + '쪽</span>' +
        '<span class="pr-panel-item__snippet"></span>';
      jumpBtn.querySelector('.pr-panel-item__snippet').textContent = memos[pageIndex];
      jumpBtn.setAttribute('aria-label', (pageIndex + 1) + '쪽 메모로 이동');
      jumpBtn.addEventListener('click', function () {
        book.turnToPage(pageIndex);
        hideHintOnce();
        openMemoPanel();
      });

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'pr-panel-item__delete';
      deleteBtn.textContent = '✕';
      deleteBtn.setAttribute('aria-label', (pageIndex + 1) + '쪽 메모 삭제');
      deleteBtn.addEventListener('click', function () {
        delete memos[pageIndex];
        saveMemos();
        if (book.currentIndex === pageIndex) {
          updateMemoUI(pageIndex);
          if (memoOpenPageIndex === pageIndex && memoTextarea) memoTextarea.value = '';
        }
        renderMemoList();
      });

      item.appendChild(jumpBtn);
      item.appendChild(deleteBtn);
      memoListEl.appendChild(item);
    });
  }

  function openMemoPanel() {
    if (!memoPanel || !memoTextarea) return;
    closeBookmarkPanel();
    memoOpenPageIndex = book.currentIndex;
    memoTextarea.value = memos[memoOpenPageIndex] || '';
    renderMemoList();
    memoPanel.hidden = false;
    memoTextarea.focus();
  }

  function closeMemoPanel() {
    if (memoPanel) memoPanel.hidden = true;
    if (memoOpenPageIndex === null || !memoTextarea) return;
    var value = memoTextarea.value;
    if (value && value.trim()) memos[memoOpenPageIndex] = value; else delete memos[memoOpenPageIndex];
    saveMemos();
    updateMemoUI(memoOpenPageIndex);
    memoOpenPageIndex = null;
  }

  if (memoBtn) memoBtn.addEventListener('click', openMemoPanel);
  if (memoCloseBtn) memoCloseBtn.addEventListener('click', closeMemoPanel);

  function updateIndicator(pageIndex, totalPages) {
    if (currentEl) currentEl.textContent = String(pageIndex + 1);
    if (totalEl) totalEl.textContent = String(totalPages);
    if (prevBtn) prevBtn.disabled = pageIndex <= 0;
    if (nextBtn) nextBtn.disabled = pageIndex >= totalPages - 1;
    if (firstBtn) firstBtn.disabled = pageIndex <= 0;
    if (lastBtn) lastBtn.disabled = pageIndex >= totalPages - 1;
    setActiveIndexTab(pageIndex);
    updateBookmarkUI(pageIndex);
    updateMemoUI(pageIndex);
  }

  function hideHintOnce() {
    if (hintEl && !hintEl.classList.contains('is-hidden')) {
      hintEl.classList.add('is-hidden');
    }
  }

  var indexTabs = [];

  function buildIndexRail(numPages) {
    if (!indexRail) return;
    indexRail.innerHTML = '';
    indexTabs = [];
    indexRail.classList.toggle('pr-index-rail--top', isMobileLayout());

    CHAPTERS.forEach(function (chapter) {
      var pageIndex = Math.max(0, Math.min(numPages - 1, chapter.page - 1));

      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'pr-index-tab';
      var titleLines = chapter.title.split('\n');
      titleLines.forEach(function (line, i) {
        if (i > 0) tab.appendChild(document.createElement('br'));
        tab.appendChild(document.createTextNode(line));
      });
      tab.setAttribute('aria-label', titleLines.join(' ') + ' 부분으로 이동');
      tab.style.setProperty('--tab-color', chapter.color);
      tab.style.setProperty('--tab-text', chapter.textColor);
      tab.dataset.pageIndex = String(pageIndex);

      tab.addEventListener('click', function () {
        book.turnToPage(pageIndex);
        hideHintOnce();
      });

      indexRail.appendChild(tab);
      indexTabs.push(tab);
    });
  }

  function setActiveIndexTab(realPageIndex) {
    var visibleIndex = realPageIndex + 1;
    var activeTab = null;
    for (var i = 0; i < indexTabs.length; i++) {
      if (Number(indexTabs[i].dataset.pageIndex) <= visibleIndex) {
        activeTab = indexTabs[i];
      }
    }
    indexTabs.forEach(function (tab) {
      tab.classList.toggle('is-active', tab === activeTab);
    });
  }

  // 우클릭 저장/드래그 방지
  document.addEventListener('contextmenu', function (event) {
    event.preventDefault();
  });

  document.addEventListener('dragstart', function (event) {
    event.preventDefault();
  });

  // ============================================================
  // 책 엔진 (canvas 없이 CSS 3D transform으로 페이지 넘김을 구현한다)
  //
  // St.PageFlip은 canvas에 이미지를 다시 그려서 페이지 곡선 효과를 내는데,
  // 원본이 3000px대의 큰 이미지라 화면 표시 크기(보통 500px 안팎)로 줄여
  // 그리는 과정에서 브라우저 네이티브 이미지 스케일링보다 화질이 떨어지는
  // 문제가 있었다(캔버스 2D drawImage vs 네이티브 <img>/background-image
  // 스케일링의 화질 차이). 대신 실제 이미지를 background-image로 그대로
  // 보여주고, 넘어가는 한 장만 뒤로 숨겨지는(backface-visibility) div를
  // 3D로 회전시켜 곡선 효과를 낸다. 정적인 페이지는 브라우저가 알아서
  // 최적의 화질로 그려주므로 100%에서도 흐려지지 않는다.
  // ============================================================

  var pageImages = null;
  var pageAspect = 0.7;
  var pageCount = 0;

  var book = {
    currentIndex: 0,
    dims: { width: 0, height: 0 },
    leftEl: null,
    rightEl: null,
    flipEl: null,
    dragState: null,

    // 특정 실제 페이지(target, 0-based)를 포함하는 스프레드의 "왼쪽(또는 단독) 페이지"
    // 인덱스를 계산한다. 앞/뒤 표지는 항상 혼자 보여주고, 나머지는 [홀수, 홀수+1]
    // 쌍으로 스프레드를 이룬다(예: [1,2] [3,4] ...). 모바일에서는 한 페이지씩만
    // 보여주므로 그대로 쓴다.
    spreadLeftFor: function (target) {
      var count = pageCount;
      target = Math.max(0, Math.min(count - 1, target));
      if (isMobileLayout()) return target;
      if (target === 0 || target === count - 1) return target;
      return (target % 2 === 1) ? target : target - 1;
    },

    isCoverIndex: function (index) {
      return index === 0 || index === pageCount - 1;
    },

    init: function (images, count, aspect) {
      pageImages = images;
      pageCount = count;
      pageAspect = aspect;
      this.build();
    },

    // 처음 한 번만 DOM 구조(좌/우 페이지 div)를 만들어두고, 이후에는 배경 이미지와
    // 크기만 바꿔서 재사용한다. 매번 새로 만들면 St.PageFlip 때처럼 재생성 비용이
    // 들고, 진행 중인 드래그 애니메이션도 끊긴다.
    build: function () {
      bookEl.innerHTML = '';
      this.leftEl = document.createElement('div');
      this.leftEl.className = 'pv-page pv-page--left';
      this.rightEl = document.createElement('div');
      this.rightEl.className = 'pv-page pv-page--right';
      bookEl.appendChild(this.leftEl);
      bookEl.appendChild(this.rightEl);
      this.attachDragHandlers();
      this.resize();
      this.render();
      bookEl.classList.add('is-ready');
      if (loadingEl) loadingEl.classList.add('is-hidden');
    },

    // 화면 크기가 바뀔 때(리사이즈, 확대) 페이지 박스 크기를 다시 계산해서 반영한다.
    resize: function () {
      this.dims = sizeBookToStage(pageAspect);
      var mobile = isMobileLayout();
      var showingSingle = mobile || this.isCoverIndex(this.currentIndex);
      var totalWidth = showingSingle ? this.dims.width : this.dims.width * 2;
      bookEl.style.width = totalWidth + 'px';
      bookEl.style.height = this.dims.height + 'px';
      if (bookCropEl) {
        bookCropEl.style.width = totalWidth + 'px';
        bookCropEl.style.height = this.dims.height + 'px';
      }
      this.leftEl.style.width = this.dims.width + 'px';
      this.rightEl.style.width = this.dims.width + 'px';
    },

    // currentIndex 기준으로 화면에 실제로 보여줄 페이지(들)를 계산해서 배경 이미지를
    // 채운다. 앞/뒤 표지는 페이지 한 장만, 나머지는 두 장을 나란히 보여준다.
    render: function () {
      this.cancelDrag();
      var mobile = isMobileLayout();
      var single = mobile || this.isCoverIndex(this.currentIndex);
      bookEl.classList.toggle('pv-book--single', single);

      if (single) {
        this.leftEl.style.backgroundImage = 'url(' + pageImages[this.currentIndex] + ')';
        this.leftEl.style.display = '';
        this.rightEl.style.display = 'none';
      } else {
        this.leftEl.style.backgroundImage = 'url(' + pageImages[this.currentIndex] + ')';
        this.rightEl.style.backgroundImage = 'url(' + pageImages[this.currentIndex + 1] + ')';
        this.leftEl.style.display = '';
        this.rightEl.style.display = '';
      }

      this.resize();
      updateIndicator(this.currentIndex, pageCount);
      positionIndexRail();
    },

    getCurrentPageIndex: function () {
      return this.currentIndex;
    },

    // 애니메이션 없이 바로 전환 (버튼/목차/책갈피/페이지 점프에서 사용)
    turnToPage: function (target) {
      var left = this.spreadLeftFor(target);
      this.currentIndex = left;
      this.render();
    },

    turnToNextPage: function () {
      var mobile = isMobileLayout();
      var cur = this.currentIndex;
      if (mobile) { this.turnToPage(Math.min(pageCount - 1, cur + 1)); return; }
      if (cur === pageCount - 1) return;
      if (cur === 0) { this.turnToPage(1); return; }
      this.turnToPage(cur + 2);
    },

    turnToPrevPage: function () {
      var mobile = isMobileLayout();
      var cur = this.currentIndex;
      if (mobile) { this.turnToPage(Math.max(0, cur - 1)); return; }
      if (cur === 0) return;
      if (cur === pageCount - 1) { this.turnToPage(pageCount - 2); return; }
      this.turnToPage(cur - 2);
    },

    // 다음/이전으로 넘어갈 목표 인덱스가 있는지(=이동 가능한지)만 알려준다.
    // 실제 이동은 하지 않는다 — 드래그 시작 시 방향을 결정하는 데만 쓴다.
    hasNext: function () { return this.currentIndex < pageCount - 1; },
    hasPrev: function () { return this.currentIndex > 0; },

    // --- 모서리 드래그로 페이지를 곡선으로 넘기는 효과 ---
    // flip 엘리먼트만 치우는 것과, 드래그 상태 전체를 끝내는 것을 분리해둔다.
    // beginFlip()은 새 flip을 만들기 직전에 "혹시 남아있는 엘리먼트"만 치워야
    // 하는데, 만약 dragState까지 같이 지워버리면 막 시작된 이번 드래그의
    // 진행 상태(dragState)까지 날아가서 이후 pointermove가 전부 무시되는
    // 버그가 있었다.
    removeFlipEl: function () {
      if (this._flipRaf) { cancelAnimationFrame(this._flipRaf); this._flipRaf = null; }
      if (this.flipEl && this.flipEl.parentNode) this.flipEl.parentNode.removeChild(this.flipEl);
      this.flipEl = null;
      this.flipImg = null;
    },

    cancelDrag: function () {
      this.removeFlipEl();
      this.dragState = null;
    },

    attachDragHandlers: function () {
      var self = this;
      var activePointerId = null;

      function pointerDown(event) {
        if (activePointerId !== null) return;
        if (event.button !== undefined && event.button !== 0) return;
        var bookRect = bookEl.getBoundingClientRect();
        var x = event.clientX - bookRect.left;
        var mobile = isMobileLayout();
        var single = mobile || self.isCoverIndex(self.currentIndex);

        // 스프레드 모드에서는 오른쪽 절반을 잡으면 다음 페이지, 왼쪽 절반을
        // 잡으면 이전 페이지로 넘기는 드래그를 시작한다. 단독 페이지(표지·모바일)
        // 모드에서는 어디를 잡아도 되고, 처음 움직인 방향으로 방향을 정한다.
        var direction = null;
        if (!single) {
          direction = (x >= bookRect.width / 2) ? 'next' : 'prev';
          if (direction === 'next' && !self.hasNext()) return;
          if (direction === 'prev' && !self.hasPrev()) return;
        } else {
          if (!self.hasNext() && !self.hasPrev()) return;
        }

        activePointerId = event.pointerId;
        self.dragState = {
          single: single,
          direction: direction,
          startX: event.clientX,
          pageWidth: self.dims.width || bookRect.width,
          progress: 0,
          committed: false,
          // 거의 안 움직이고 손을 떼면(그냥 클릭/탭) 어느 쪽을 눌렀는지 판단하는 데 쓴다.
          downX: x,
          bookWidth: bookRect.width
        };

        if (direction) self.beginFlip(direction);

        if (event.target.setPointerCapture) {
          try { event.target.setPointerCapture(event.pointerId); } catch (e) { /* 무시 */ }
        }
        event.preventDefault();
      }

      function pointerMove(event) {
        if (activePointerId === null || event.pointerId !== activePointerId) return;
        var st = self.dragState;
        if (!st) return;
        var dx = event.clientX - st.startX;

        if (!st.direction) {
          // 단독 페이지에서 아직 방향이 안 정해졌으면, 움직인 방향으로 결정한다.
          if (Math.abs(dx) < 4) return;
          var dir = dx < 0 ? 'next' : 'prev';
          if (dir === 'next' && !self.hasNext()) { dir = self.hasPrev() ? 'prev' : null; }
          if (dir === 'prev' && !self.hasPrev()) { dir = self.hasNext() ? 'next' : null; }
          if (!dir) return;
          st.direction = dir;
          self.beginFlip(dir);
        }

        var progress = st.direction === 'next' ? (-dx / st.pageWidth) : (dx / st.pageWidth);
        progress = Math.max(0, Math.min(1, progress));
        st.progress = progress;
        self.drawFlipFrame(progress);
        hideHintOnce();
        event.preventDefault();
      }

      function pointerUp(event) {
        if (activePointerId === null || event.pointerId !== activePointerId) return;
        activePointerId = null;
        var st = self.dragState;
        if (!st) { self.cancelDrag(); return; }

        // 거의 움직이지 않고 손을 뗐다면 드래그가 아니라 그냥 클릭/탭이다.
        // 이때는 접히는 애니메이션 없이, 버튼을 누른 것처럼 클릭한 쪽으로
        // 바로 넘어가야 한다(안 그러면 "가장자리를 클릭해도 안 넘어간다"는
        // 문제가 생긴다).
        var moved = Math.abs(event.clientX - st.startX);
        if (moved < 6 && st.progress <= 0.05) {
          self.cancelDrag();
          var clickDir = st.direction || (st.downX < st.bookWidth / 2 ? 'prev' : 'next');
          if (clickDir === 'next') self.turnToNextPage(); else self.turnToPrevPage();
          hideHintOnce();
          return;
        }

        if (!st.direction) { self.cancelDrag(); return; }
        if (st.progress > 0.5) {
          self.finishFlip(st.direction, st.progress);
        } else {
          self.revertFlip(st.progress);
        }
      }

      bookEl.addEventListener('pointerdown', pointerDown);
      window.addEventListener('pointermove', pointerMove);
      window.addEventListener('pointerup', pointerUp);
      window.addEventListener('pointercancel', pointerUp);
    },

    // 드래그가 시작되면, 넘어갈 페이지 자리를 미리 다음/이전 스프레드 내용으로
    // 바꿔둔다(어차피 그 위를 덮은 flipEl이 가리고 있어서 안 보인다).
    // 그 위에 지금 보이던 페이지 그림을 얹은 canvas를 만들어서 종이 말림
    // 모양으로 그린다. 가만히 있을 때(정적 상태)는 이 canvas를 전혀 쓰지
    // 않고 background-image로만 보여주므로, "100%에서도 흐려 보이는" 문제와는
    // 무관하다 — canvas는 오직 손가락이 페이지를 붙잡고 있는 짧은 순간에만
    // 잠깐 존재했다가, 손을 떼는 즉시 사라지고 다시 선명한 이미지로 바뀐다.
    beginFlip: function (direction) {
      this.removeFlipEl();
      var mobile = isMobileLayout();
      var single = mobile || this.isCoverIndex(this.currentIndex);
      var hingeAtRight = (direction === 'prev');
      var flippingRealIndex = (direction === 'next')
        ? (single ? this.currentIndex : this.currentIndex + 1)
        : this.currentIndex;
      var frontSrc = pageImages[flippingRealIndex];

      var dpr = window.devicePixelRatio || 1;
      var w = this.dims.width, h = this.dims.height;
      var canvas = document.createElement('canvas');
      canvas.className = 'pv-flip-canvas';
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.top = '0px';
      canvas.style.left = (direction === 'next')
        ? (single ? '0px' : w + 'px')
        : '0px';
      bookEl.appendChild(canvas);
      this.flipEl = canvas;
      this.flipHingeAtRight = hingeAtRight;
      this.flipDpr = dpr;

      var img = new Image();
      var self = this;
      this.flipImg = img;
      img.onload = function () {
        if (self.flipImg === img) self.drawFlipFrame(0);
      };
      img.src = frontSrc;
      if (img.complete && img.naturalWidth) this.drawFlipFrame(0);

      // 미리 다음/이전 내용으로 바꿔서, flipEl이 다 돌아가 사라지는 순간
      // 바로 밑에 맞는 내용이 있게 한다.
      var pendingLeft = (direction === 'next') ? this.nextLeftIndex() : this.prevLeftIndex();
      this._pendingLeft = pendingLeft;
      this.paintSpread(pendingLeft);
    },

    nextLeftIndex: function () {
      var mobile = isMobileLayout();
      var cur = this.currentIndex;
      if (mobile) return Math.min(pageCount - 1, cur + 1);
      if (cur === 0) return this.spreadLeftFor(1);
      var candidate = cur + 2;
      return this.spreadLeftFor(candidate >= pageCount - 1 ? pageCount - 1 : candidate);
    },

    prevLeftIndex: function () {
      var mobile = isMobileLayout();
      var cur = this.currentIndex;
      if (mobile) return Math.max(0, cur - 1);
      if (cur === pageCount - 1) return this.spreadLeftFor(pageCount - 2);
      return this.spreadLeftFor(cur - 2);
    },

    // flipEl(넘어가는 종이) 아래 깔린 정적 페이지들의 내용을 바꾼다. render()와
    // 비슷하지만 여기서는 currentIndex를 바꾸지 않고(드래그 취소 가능성이 있으므로)
    // 화면에 보이는 이미지만 미리 바꿔둔다.
    paintSpread: function (leftIndex) {
      var mobile = isMobileLayout();
      var single = mobile || this.isCoverIndex(leftIndex);
      if (single) {
        this.leftEl.style.backgroundImage = 'url(' + pageImages[leftIndex] + ')';
        this.rightEl.style.display = 'none';
        this.leftEl.style.display = '';
      } else {
        this.leftEl.style.backgroundImage = 'url(' + pageImages[leftIndex] + ')';
        this.rightEl.style.backgroundImage = 'url(' + pageImages[leftIndex + 1] + ')';
        this.leftEl.style.display = '';
        this.rightEl.style.display = '';
      }
    },

    // 종이가 원기둥에 말려 올라가듯 접히는 모양을 canvas에 직접 그린다.
    // 경첩(책등에 붙은 쪽)에 가까운 부분은 거의 평평하게, 자유단(넘어가는
    // 쪽 가장자리)에 가까운 부분일수록 더 많이 말리도록 페이지를 여러 개의
    // 가는 세로 조각으로 나눠서, 각 조각을 "반지름 R인 원기둥 표면" 위의
    // 위치로 재배치하고 명암을 넣는다 — 흔히 쓰이는 canvas 페이지 말림 근사
    // 기법이다(특정 라이브러리 코드를 베낀 게 아니라 일반적인 방식을 직접 구현).
    drawFlipFrame: function (progress) {
      var canvas = this.flipEl;
      var img = this.flipImg;
      if (!canvas || !img || !img.naturalWidth) return;
      var dpr = this.flipDpr || 1;
      var w = this.dims.width, h = this.dims.height;
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (progress <= 0.001) {
        ctx.drawImage(img, 0, 0, w, h);
        return;
      }

      var hingeAtRight = this.flipHingeAtRight;
      // 페이지 전체를 구부리지 않는다 — 대부분(몸통)은 기존처럼 그냥 납작하게
      // 회전하는 느낌(원근감에 따른 폭 축소)만 주고, 넘어가는 쪽 "끝부분"만
      // 살짝 말려 올라간 것처럼 보이게 한다.
      var angle = progress * Math.PI;
      var bodyWidth = Math.max(0, w * Math.cos(angle));
      if (bodyWidth <= 0.5) return;

      // 끝부분만 살짝 마는 정도 — 몸통 폭의 일부, 최대 픽셀 수로 상한을 둔다.
      var curlWidth = Math.min(34, bodyWidth * 0.35);
      var flatWidth = bodyWidth - curlWidth;

      // 몸통(평평하게 남는 부분): 원본 전체를 bodyWidth로 압축해서 한 번에 그린다.
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, hingeAtRight ? (w - bodyWidth) : 0, 0, bodyWidth, h);

      if (curlWidth <= 0.5) return;

      // 끝부분: flatWidth 경계에서 이어받아, 그 경계에서는 각도 0(몸통과 자연스럽게
      // 이어짐)으로 시작해서 맨 끝(자유단)으로 갈수록 말리는 각도가 커지는 작은
      // 원기둥 롤을 그린다.
      var Rcurl = curlWidth / 1.8;
      var N = 14;
      var srcCurlStart = hingeAtRight ? 0 : img.naturalWidth * flatWidth / bodyWidth;
      var srcCurlEnd = hingeAtRight ? img.naturalWidth * curlWidth / bodyWidth : img.naturalWidth;

      for (var i = 0; i < N; i++) {
        var t0 = i / N, t1 = (i + 1) / N;
        var srcX0 = srcCurlStart + (srcCurlEnd - srcCurlStart) * t0;
        var srcX1 = srcCurlStart + (srcCurlEnd - srcCurlStart) * t1;
        var srcW = Math.max(0.5, srcX1 - srcX0);
        // d: 몸통과 이어지는 경계에서부터(0) 맨 끝(curlWidth)까지의 거리
        var d0 = t0 * curlWidth, d1 = t1 * curlWidth;
        var a0 = Math.min(Math.PI, d0 / Rcurl);
        var a1 = Math.min(Math.PI, d1 / Rcurl);
        var s0 = Rcurl * Math.sin(a0);
        var s1 = Rcurl * Math.sin(a1);
        var drawX0, drawX1;
        if (hingeAtRight) {
          // 이 경우 자유단은 화면 왼쪽(x가 작은 쪽)에 있다.
          drawX0 = (w - flatWidth) - s1;
          drawX1 = (w - flatWidth) - s0;
        } else {
          drawX0 = flatWidth + s0;
          drawX1 = flatWidth + s1;
        }
        var drawW = Math.max(0.6, drawX1 - drawX0);
        var shade = Math.cos((a0 + a1) / 2);

        if (shade >= 0) {
          var brightness = 0.45 + 0.55 * shade;
          ctx.drawImage(img, srcX0, 0, srcW, img.naturalHeight, drawX0, 0, drawW, h);
          if (brightness < 1) {
            ctx.fillStyle = 'rgba(0,0,0,' + (1 - brightness) + ')';
            ctx.fillRect(drawX0, 0, drawW, h);
          }
        } else {
          var backShade = Math.min(1, -shade);
          ctx.fillStyle = 'rgb(230,226,218)';
          ctx.fillRect(drawX0, 0, drawW, h);
          ctx.fillStyle = 'rgba(0,0,0,' + (0.15 + 0.35 * backShade) + ')';
          ctx.fillRect(drawX0, 0, drawW, h);
        }
      }
    },

    // 드래그 중에는 pointermove가 그때그때 진행도를 주지만, 손을 떼서 마무리할
    // 때는 마지막 진행도에서 0 또는 1까지 짧게 애니메이션으로 이어줘야 한다.
    // canvas는 CSS transition을 못 쓰므로 requestAnimationFrame으로 직접 보간한다.
    animateFlip: function (fromProgress, toProgress, duration, onDone) {
      var self = this;
      var flipElAtStart = this.flipEl;
      var startTime = null;
      function step(ts) {
        if (self.flipEl !== flipElAtStart) return;
        if (startTime === null) startTime = ts;
        var t = Math.min(1, (ts - startTime) / duration);
        var eased = 1 - Math.pow(1 - t, 2);
        var p = fromProgress + (toProgress - fromProgress) * eased;
        self.drawFlipFrame(p);
        if (t < 1) {
          self._flipRaf = requestAnimationFrame(step);
        } else {
          onDone();
        }
      }
      self._flipRaf = requestAnimationFrame(step);
    },

    // finishFlip/revertFlip이 끝나는 시점에, 그 사이 사용자가 벌써 다음 드래그를
    // 새로 시작해버리면 이 지연된 콜백이 "지금" 진행 중인 새 드래그의
    // flipEl/dragState를 지워버려 충돌이 났었다. animateFlip 콜백이 실제로
    // 실행되는 시점에 그 flipEl이 여전히 이번 호출이 만든 그 엘리먼트일
    // 때만 정리하도록 캡처해서 비교한다.
    finishFlip: function (direction, fromProgress) {
      var self = this;
      var flipElAtStart = this.flipEl;
      if (!flipElAtStart) { this.cancelDrag(); return; }
      var pendingLeft = this._pendingLeft;
      this.animateFlip(fromProgress, 1, 200, function () {
        if (self.flipEl !== flipElAtStart) return;
        self.currentIndex = pendingLeft;
        self.cancelDrag();
        self.render();
        if (memoPanel && !memoPanel.hidden) closeMemoPanel();
      });
    },

    revertFlip: function (fromProgress) {
      var self = this;
      var flipElAtStart = this.flipEl;
      if (!flipElAtStart) { this.cancelDrag(); return; }
      this.animateFlip(fromProgress, 0, 160, function () {
        if (self.flipEl !== flipElAtStart) return;
        // 취소됐으므로 밑에 미리 바꿔둔 내용을 원래대로 되돌린다.
        self.paintSpread(self.currentIndex);
        self.cancelDrag();
      });
    }
  };

  pageCount = PAGE_COUNT;
  pageImages = [];
  for (var i = 1; i <= PAGE_COUNT; i++) {
    pageImages.push(pageUrl(i));
  }

  // 첫 페이지 이미지의 실제 가로세로 비율을 읽어서 책 크기를 계산한다.
  var probe = new Image();
  probe.onload = function () {
    if (probe.naturalWidth && probe.naturalHeight) {
      pageAspect = probe.naturalWidth / probe.naturalHeight;
    }
    buildIndexRail(pageCount);
    renderBookmarkList();
    book.init(pageImages, pageCount, pageAspect);
  };
  probe.onerror = function () {
    console.error('페이지 이미지를 불러오지 못했습니다:', pageImages[0]);
    showError('이북을 불러오는 중 문제가 발생했어요.');
  };
  probe.src = pageImages[0];

  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      book.turnToPrevPage();
      hideHintOnce();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      book.turnToNextPage();
      hideHintOnce();
    });
  }

  if (firstBtn) {
    firstBtn.addEventListener('click', function () {
      book.turnToPage(0);
      hideHintOnce();
    });
  }

  if (lastBtn) {
    lastBtn.addEventListener('click', function () {
      book.turnToPage(pageCount - 1);
      hideHintOnce();
    });
  }

  // 하단 페이지 숫자를 눌러서 원하는 페이지로 바로 이동. 숫자 자리를 입력창으로
  // 바꿔치기해서 그 자리에서 바로 타이핑하고 엔터로 이동할 수 있게 한다.
  var indicatorEl = document.getElementById('pr-indicator');

  function enterPageJumpMode() {
    if (!pageJumpInput || !indicatorEl || !currentEl) return;
    pageJumpInput.value = currentEl.textContent;
    indicatorEl.classList.add('is-editing');
    pageJumpInput.focus();
    pageJumpInput.select();
  }

  function exitPageJumpMode() {
    if (indicatorEl) indicatorEl.classList.remove('is-editing');
  }

  function commitPageJump() {
    if (!pageJumpInput) return;
    var target = parseInt(pageJumpInput.value, 10);
    if (target >= 1 && target <= pageCount) {
      book.turnToPage(target - 1);
      hideHintOnce();
    }
    exitPageJumpMode();
  }

  if (pageJumpBtn) {
    pageJumpBtn.addEventListener('click', enterPageJumpMode);
  }

  if (pageJumpInput) {
    pageJumpInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') commitPageJump();
      if (event.key === 'Escape') exitPageJumpMode();
    });
    pageJumpInput.addEventListener('blur', exitPageJumpMode);
  }

  document.addEventListener('keydown', function (event) {
    var tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') book.turnToNextPage();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') book.turnToPrevPage();
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      book.render();
    }, 200);
  });
})();
