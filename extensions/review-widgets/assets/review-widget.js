(() => {
  const LOG_PREFIX = "[reviews-widget]";
  const stars = (rating) => "★★★★★".slice(0, Math.round(rating)) + "☆☆☆☆☆".slice(0, 5 - Math.round(rating));

  const fmtDate = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString();
  };

  const byId = (id) => document.getElementById(id);

  const previewReviews = [
    {
      id: 'preview-1', reviewer_name: 'Emma', rating: 5, title: 'Amazing quality', body: 'Looks premium and feels durable. Shipping was quick too.', image_url: 'https://picsum.photos/seed/review1/600/600', submitted_at: new Date().toISOString()
    },
    {
      id: 'preview-2', reviewer_name: 'Liam', rating: 4, title: 'Great value', body: 'Very happy with the purchase. Would definitely buy again.', image_url: 'https://picsum.photos/seed/review2/600/600', submitted_at: new Date().toISOString()
    },
    {
      id: 'preview-3', reviewer_name: 'Sofia', rating: 5, title: '', body: 'Super comfortable and exactly as described.', image_url: '', submitted_at: new Date().toISOString()
    },
    {
      id: 'preview-4', reviewer_name: 'Noah', rating: 4, title: 'Nice finish', body: 'Setup was easy and the overall look is very clean.', image_url: 'https://picsum.photos/seed/review4/600/600', submitted_at: new Date().toISOString()
    }
  ];

  const mounts = Array.from(document.querySelectorAll('.oc-reviews-widget'));
  if (!mounts.length) {
    console.warn(`${LOG_PREFIX} no mount elements found`);
    return;
  }

  mounts.forEach(async (mount) => {
    const shop = mount.dataset.shopDomain;
    const productId = mount.dataset.productId;
    const initialOpen = mount.dataset.showBreakdown === 'true';
    const designMode = mount.dataset.designMode === 'true';

    if (!shop || !productId) {
      mount.innerHTML = '<div class="oc-rw-empty">Widget missing product context.</div>';
      return;
    }

    const url = `/apps/aethra-reviews?shop=${encodeURIComponent(shop)}&product_id=${encodeURIComponent(productId)}`;

    try {
      console.info(`${LOG_PREFIX} mount found`, { shop, productId, designMode, url });
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = setTimeout(() => { if (ac) ac.abort(); }, 10000);
      let res;
      try {
        res = await fetch(url, { credentials: 'same-origin', signal: ac ? ac.signal : undefined });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error(`Unexpected content-type: ${contentType || 'unknown'}`);
      const data = await res.json();
      if (!data || typeof data !== 'object' || !data.ok) throw new Error(data?.error || 'Failed to load reviews');

      const settings = data.settings || {};
      let summary = data.summary || { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
      let reviews = data.reviews || [];

      const hasMedia = (review) => {
        const media = (review.media && review.media.length ? review.media : (review.image_url ? [{ media_url: review.image_url }] : []));
        return media.length > 0;
      };
      const reviewTime = (review) => new Date(review.published_at || review.submitted_at || 0).getTime() || 0;
      const sortMode = String(data.sort_mode || settings.default_sort_mode || 'image_first');
      const applySort = (list) => {
        const sorted = [...list];
        sorted.sort((a, b) => {
          if (sortMode === 'oldest') return reviewTime(a) - reviewTime(b);
          if (sortMode === 'highest_rated') {
            if (Number(b.rating || 0) !== Number(a.rating || 0)) return Number(b.rating || 0) - Number(a.rating || 0);
            return reviewTime(b) - reviewTime(a);
          }
          if (sortMode === 'lowest_rated') {
            if (Number(a.rating || 0) !== Number(b.rating || 0)) return Number(a.rating || 0) - Number(b.rating || 0);
            return reviewTime(b) - reviewTime(a);
          }
          if (sortMode === 'image_first') {
            const mediaDelta = Number(hasMedia(b)) - Number(hasMedia(a));
            if (mediaDelta !== 0) return mediaDelta;
            return reviewTime(b) - reviewTime(a);
          }
          return reviewTime(b) - reviewTime(a);
        });
        return sorted;
      };

      if (!reviews.length && designMode) {
        reviews = applySort(previewReviews);
        summary = {
          average: 4.5,
          count: 124,
          distribution: { 1: 3, 2: 6, 3: 12, 4: 33, 5: 70 },
        };
      }

      const toPositiveInt = (value, fallback) => {
        if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.floor(value));
        if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Math.max(1, Math.floor(Number(value.trim())));
        return fallback;
      };
      const initialLimit = toPositiveInt(data?.pagination?.configured_initial_limit, toPositiveInt(settings.initial_reviews_limit, 20));
      const loadMoreStep = toPositiveInt(data?.pagination?.configured_load_more_step, toPositiveInt(settings.load_more_step, 20));
      const loadMoreLabel = String(settings.load_more_label || 'Load more reviews');
      let visibleCount = initialLimit;
      let currentOffset = Number(data?.pagination?.next_offset || reviews.length || 0);
      let hasMore = Boolean(data?.pagination?.has_more);
      let loadingMore = false;

      const total = Number(summary.count || 0);
      const average = Number(summary.average || 0);
      const dist = summary.distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const summaryStarSize = Number(settings.summary_star_size_px || 15);
      const summaryTextSize = Number(settings.summary_text_size_px || settings.body_size_px || 14);
      console.info(`${LOG_PREFIX} summary sizes`, { summaryStarSize, summaryTextSize });

      const styleVars = `
        --rw-star:${settings.star_color};
        --rw-text:${settings.text_color};
        --rw-meta:${settings.meta_text_color};
        --rw-card-bg:${settings.card_bg_color};
        --rw-border:${settings.card_border_color};
        --rw-badge-bg:${settings.verified_badge_color || '#eef2ff'};
        --rw-badge-text:${settings.verified_badge_text_color || '#4f46e5'};
        --rw-radius:${settings.border_radius_px}px;
        --rw-heading-size:${settings.heading_size_px}px;
        --rw-body-size:${settings.body_size_px}px;
        --rw-meta-size:${settings.meta_size_px}px;
        --rw-summary-star-size:${settings.summary_star_size_px || 15}px;
        --rw-summary-text-size:${settings.summary_text_size_px || settings.body_size_px || 14}px;
        --rw-gap:${settings.card_spacing_px}px;
        --rw-desktop-cols:${settings.desktop_columns || 3};
        --rw-mobile-cols:${settings.mobile_columns || 2};
        font-family:${settings.font_family};
      `;

      const breakdownHtml = [5,4,3,2,1].map((s) => {
        const c = Number(dist[s] ?? dist[String(s)] ?? 0);
        const pct = total > 0 ? Math.round((c / total) * 100) : 0;
        return `<div class="oc-rw-line">
          <div>${s}★</div>
          <div class="oc-rw-bar"><div class="oc-rw-bar-fill" style="width:${pct}%"></div></div>
          <div>${c}</div>
        </div>`;
      }).join('');

      const renderCardsHtml = () => reviews.slice(0, visibleCount).map((r, reviewIdx) => {
        const media = (r.media && r.media.length ? r.media : (r.image_url ? [{ media_url: r.image_url }] : []));
        const firstImage = media[0]?.media_url;
        const extraCount = media.length > 1 ? media.length - 1 : 0;
        return `
        <article class="oc-rw-card">
          ${firstImage ? `<button type="button" class="oc-rw-image-wrap oc-rw-image-open" data-rw-open-lightbox="1" data-review-index="${reviewIdx}" data-media-index="0"><img class="oc-rw-image" src="${firstImage}" alt="Review image" loading="lazy"/>${extraCount ? `<span class="oc-rw-image-count">+${extraCount}</span>` : ''}</button>` : ''}
          <div class="oc-rw-card-body">
            <div class="oc-rw-reviewer-row">
              <span class="oc-rw-reviewer-name">${r.reviewer_name || 'Anonymous'}</span>
              ${(settings.show_verified_badge ? `<span class="oc-rw-verified"><span class="oc-rw-verified-icon">✓</span>${settings.verified_badge_label || 'Verified'}</span>` : '')}
            </div>
            <div class="oc-rw-meta-row">
              <span class="oc-rw-stars">${stars(Number(r.rating || 0))}</span>
              ${(settings.show_review_date ? `<span>${fmtDate(r.submitted_at || r.published_at)}</span>` : '')}
            </div>
            ${r.title ? `<div class="oc-rw-title">${r.title}</div>` : ''}
            <div class="oc-rw-text">${r.body || ''}</div>
          </div>
        </article>
      `;
      }).join('');

      const id = `rw-breakdown-${Math.random().toString(36).slice(2)}`;

      mount.innerHTML = `
        <div class="oc-rw-root" style="${styleVars}">
          ${(settings.section_heading ? `<div class="oc-rw-heading">${settings.section_heading}</div>` : '')}
          <div class="oc-rw-summary">
            <div class="oc-rw-summary-top">
              <div class="oc-rw-summary-left">
                <span class="oc-rw-stars" style="font-size:${summaryStarSize}px;">${stars(average)}</span>
                <span class="oc-rw-rating" style="font-size:${summaryTextSize}px;">${average.toFixed(1)}</span>
                ${settings.show_review_count !== false ? `<span class="oc-rw-count" style="font-size:${summaryTextSize}px;">${total} reviews</span>` : ''}
                ${settings.show_rating_breakdown ? `<button class="oc-rw-caret-btn" data-toggle="${id}" aria-label="Toggle breakdown">▾</button>` : ''}
              </div>
              <button class="oc-rw-icon-btn" aria-label="Filters">⚙</button>
            </div>
            ${settings.show_write_review_btn ? `<div class="oc-rw-summary-bottom"><button class="oc-rw-btn" type="button" data-open-review-modal="1">${settings.write_review_label || 'Write a review'}</button></div>` : ''}
          </div>

          ${settings.show_rating_breakdown ? `
            <div id="${id}" class="oc-rw-breakdown" style="display:${initialOpen ? 'block' : 'none'};">
              <div class="oc-rw-break-header">
                <div>
                  <div class="oc-rw-break-average">${average.toFixed(1)}</div>
                  <div class="oc-rw-stars">${stars(average)}</div>
                  ${settings.show_review_count !== false ? `<div class="oc-rw-break-count">${total} reviews</div>` : ''}
                </div>
                <div class="oc-rw-break-lines">${breakdownHtml}</div>
              </div>
            </div>
          ` : ''}

          ${reviews.length ? `<div class="oc-rw-grid" data-rw-grid>${renderCardsHtml()}</div><div data-rw-load-more-wrap></div>` : `<div class="oc-rw-empty">${settings.empty_state_text || 'No reviews yet'}</div>`}

          <div class="oc-rw-lightbox" data-rw-lightbox hidden>
            <div class="oc-rw-lightbox-backdrop" data-rw-close-lightbox></div>
            <div class="oc-rw-lightbox-panel">
              <button type="button" class="oc-rw-lightbox-close" data-rw-close-lightbox aria-label="Close">✕</button>
              <div class="oc-rw-lightbox-grid">
                <div>
                  <div class="oc-rw-lightbox-main-wrap">
                    <button type="button" class="oc-rw-lightbox-nav oc-rw-lightbox-prev" data-rw-prev>‹</button>
                    <img class="oc-rw-lightbox-main" data-rw-main-image alt="Review image" />
                    <button type="button" class="oc-rw-lightbox-nav oc-rw-lightbox-next" data-rw-next>›</button>
                  </div>
                  <div class="oc-rw-lightbox-thumbs" data-rw-thumbs></div>
                </div>
                <div class="oc-rw-lightbox-details" data-rw-details></div>
              </div>
            </div>
          </div>

          <div class="oc-rw-modal" data-review-modal hidden>
            <div class="oc-rw-modal-backdrop" data-close-review-modal></div>
            <div class="oc-rw-modal-panel">
              <div class="oc-rw-modal-head">
                <strong>${settings.modal_title || 'Write a review'}</strong>
                <button type="button" class="oc-rw-icon-btn" data-close-review-modal aria-label="${settings.modal_close_label || 'Close'}">✕</button>
              </div>
              <div class="oc-rw-modal-subtitle">${settings.modal_subtitle || ''}</div>
              <form class="oc-rw-form" data-review-form>
                <div class="oc-rw-form-block">
                  <div class="oc-rw-form-label">${settings.modal_rating_label || 'Rating'}</div>
                  <div class="oc-rw-star-input" data-star-input>
                    ${[1,2,3,4,5].map((n) => `<button type="button" class="oc-rw-star-btn" data-star-value="${n}" aria-label="${n} stars">★</button>`).join('')}
                  </div>
                  <input type="hidden" name="rating" value="" required data-rating-value />
                </div>

                <label class="oc-rw-form-block">${settings.modal_name_label || 'Your name'}<input name="reviewer_name" required /></label>
                <label class="oc-rw-form-block">${settings.modal_review_title_label || 'Review title'}<input name="title" /></label>
                <label class="oc-rw-form-block">${settings.modal_review_body_label || 'Review'}<textarea name="body" rows="4" required></textarea></label>
                <label class="oc-rw-form-block">${settings.modal_image_label || 'Images (optional)'}<input name="images" type="file" accept="image/*" multiple data-image-input /></label>
                <div class="oc-rw-form-help">${settings.modal_image_helper_text || ''}</div>
                <div class="oc-rw-image-preview-wrap" data-image-preview-wrap hidden>
                  <div class="oc-rw-image-preview-head"><span data-image-count>0 images</span></div>
                  <div class="oc-rw-image-preview-grid" data-image-preview-grid></div>
                </div>
                <div class="oc-rw-form-error" data-form-error hidden></div>
                <div class="oc-rw-form-success" data-form-success hidden>${settings.modal_success_message || 'Thanks! Your review was submitted for moderation.'}</div>
                <button type="submit" class="oc-rw-btn" data-submit-btn>${settings.modal_submit_label || 'Submit review'}</button>
              </form>
            </div>
          </div>
        </div>
      `;

      const gridEl = mount.querySelector('[data-rw-grid]');
      const loadMoreWrap = mount.querySelector('[data-rw-load-more-wrap]');

      const renderLoadMore = () => {
        if (!loadMoreWrap) return;
        const canShowButton = (reviews.length > visibleCount) || hasMore;
        if (!canShowButton) {
          loadMoreWrap.innerHTML = '';
          return;
        }
        loadMoreWrap.innerHTML = `<div style="display:flex;justify-content:center;margin-top:16px;"><button type="button" class="oc-rw-btn" data-rw-load-more ${loadingMore ? 'disabled' : ''}>${loadingMore ? 'Loading…' : loadMoreLabel}</button></div>`;
      };

      const renderVisibleCards = () => {
        if (!gridEl) return;
        gridEl.innerHTML = renderCardsHtml();
      };

      renderVisibleCards();
      renderLoadMore();

      mount.addEventListener('click', async (ev) => {
        const loadMoreBtn = ev.target instanceof Element ? ev.target.closest('[data-rw-load-more]') : null;
        if (!loadMoreBtn || loadingMore) return;
        ev.preventDefault();

        if (visibleCount < reviews.length) {
          visibleCount = Math.min(visibleCount + loadMoreStep, reviews.length);
          renderVisibleCards();
          renderLoadMore();
          return;
        }

        if (!hasMore) {
          renderLoadMore();
          return;
        }

        loadingMore = true;
        renderLoadMore();
        try {
          const pageUrl = `${url}&offset=${encodeURIComponent(String(currentOffset))}&limit=${encodeURIComponent(String(loadMoreStep))}&sort=${encodeURIComponent(sortMode)}`;
          const nextRes = await fetch(pageUrl, { credentials: 'same-origin' });
          if (!nextRes.ok) throw new Error(`HTTP ${nextRes.status}`);
          const nextData = await nextRes.json();
          const nextReviews = Array.isArray(nextData?.reviews) ? nextData.reviews : [];
          if (nextReviews.length) {
            reviews = reviews.concat(nextReviews);
            if (designMode) reviews = applySort(reviews);
            visibleCount = Math.min(visibleCount + loadMoreStep, reviews.length);
          }
          currentOffset = Number(nextData?.pagination?.next_offset ?? (currentOffset + nextReviews.length));
          hasMore = Boolean(nextData?.pagination?.has_more);
          renderVisibleCards();
        } catch (error) {
          console.error(LOG_PREFIX, 'load more failed', error);
        } finally {
          loadingMore = false;
          renderLoadMore();
        }
      });

      mount.querySelectorAll('[data-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const el = byId(btn.getAttribute('data-toggle'));
          if (!el) return;
          const hidden = el.style.display === 'none';
          el.style.display = hidden ? 'block' : 'none';
          btn.textContent = hidden ? '▴' : '▾';
        });
      });

      const modal = mount.querySelector('[data-review-modal]');
      const form = mount.querySelector('[data-review-form]');
      const errorEl = mount.querySelector('[data-form-error]');
      const successEl = mount.querySelector('[data-form-success]');
      const submitBtn = mount.querySelector('[data-submit-btn]');
      const starBtns = Array.from(mount.querySelectorAll('[data-star-value]'));
      const ratingInput = mount.querySelector('[data-rating-value]');
      const imageInput = mount.querySelector('[data-image-input]');
      const imageWrap = mount.querySelector('[data-image-preview-wrap]');
      const imageGrid = mount.querySelector('[data-image-preview-grid]');
      const imageCount = mount.querySelector('[data-image-count]');
      let selectedFiles = [];

      const syncFileInput = () => {
        if (!imageInput) return;
        const dt = new DataTransfer();
        selectedFiles.forEach((f) => dt.items.add(f));
        imageInput.files = dt.files;
      };

      const renderPreviews = () => {
        if (!imageWrap || !imageGrid || !imageCount) return;
        imageGrid.innerHTML = '';
        if (!selectedFiles.length) {
          imageWrap.hidden = true;
          imageCount.textContent = '0 images';
          return;
        }
        imageWrap.hidden = false;
        imageCount.textContent = `${selectedFiles.length} image${selectedFiles.length > 1 ? 's' : ''}`;
        selectedFiles.forEach((file, idx) => {
          const item = document.createElement('div');
          item.className = 'oc-rw-image-preview-item';
          const img = document.createElement('img');
          img.className = 'oc-rw-image-preview-thumb';
          img.alt = 'Selected image';
          img.src = URL.createObjectURL(file);
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'oc-rw-image-preview-remove';
          remove.textContent = '×';
          remove.addEventListener('click', () => {
            selectedFiles.splice(idx, 1);
            syncFileInput();
            renderPreviews();
          });
          item.appendChild(img);
          item.appendChild(remove);
          imageGrid.appendChild(item);
        });
      };

      if (imageInput) {
        imageInput.addEventListener('change', () => {
          selectedFiles = Array.from(imageInput.files || []).slice(0, 5);
          syncFileInput();
          renderPreviews();
        });
      }

      const dropTarget = mount.querySelector('.oc-rw-image-preview-wrap') || form;
      if (dropTarget) {
        dropTarget.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropTarget.classList.add('is-drag');
        });
        dropTarget.addEventListener('dragleave', () => dropTarget.classList.remove('is-drag'));
        dropTarget.addEventListener('drop', (e) => {
          e.preventDefault();
          dropTarget.classList.remove('is-drag');
          const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => f.type.startsWith('image/'));
          if (!files.length) return;
          selectedFiles = [...selectedFiles, ...files].slice(0, 5);
          syncFileInput();
          renderPreviews();
        });
      }

      const setRating = (value) => {
        if (ratingInput) ratingInput.value = String(value || '');
        starBtns.forEach((btn) => {
          const n = Number(btn.getAttribute('data-star-value') || 0);
          btn.classList.toggle('is-active', n <= value);
        });
      };

      starBtns.forEach((btn) => {
        btn.addEventListener('mouseenter', () => setRating(Number(btn.getAttribute('data-star-value') || 0)));
        btn.addEventListener('click', () => setRating(Number(btn.getAttribute('data-star-value') || 0)));
      });
      const starInputWrap = mount.querySelector('[data-star-input]');
      if (starInputWrap) {
        starInputWrap.addEventListener('mouseleave', () => setRating(Number((ratingInput && ratingInput.value) || 0)));
      }

      const lightbox = mount.querySelector('[data-rw-lightbox]');
      const mainImage = mount.querySelector('[data-rw-main-image]');
      const thumbsEl = mount.querySelector('[data-rw-thumbs]');
      const detailsEl = mount.querySelector('[data-rw-details]');
      let lbReviewIndex = 0;
      let lbMediaIndex = 0;

      const renderLightbox = () => {
        const review = reviews[lbReviewIndex];
        if (!review) return;
        const media = (review.media && review.media.length ? review.media : (review.image_url ? [{ media_url: review.image_url }] : []));
        if (!media.length) return;
        lbMediaIndex = ((lbMediaIndex % media.length) + media.length) % media.length;
        if (mainImage) mainImage.src = media[lbMediaIndex].media_url;

        if (thumbsEl) {
          thumbsEl.innerHTML = media.map((m, idx) => `<button type="button" class="oc-rw-lightbox-thumb ${idx===lbMediaIndex?'is-active':''}" data-rw-thumb="${idx}"><img src="${m.media_url}" alt="thumb"/></button>`).join('');
        }

        if (detailsEl) {
          detailsEl.innerHTML = `
            <div class="oc-rw-reviewer-row">
              <span class="oc-rw-reviewer-name">${review.reviewer_name || 'Anonymous'}</span>
              ${(settings.show_verified_badge ? `<span class="oc-rw-verified"><span class="oc-rw-verified-icon">✓</span>${settings.verified_badge_label || 'Verified'}</span>` : '')}
            </div>
            <div class="oc-rw-meta-row">
              <span class="oc-rw-stars">${stars(Number(review.rating || 0))}</span>
              ${(settings.show_review_date ? `<span>${fmtDate(review.submitted_at || review.published_at)}</span>` : '')}
            </div>
            ${review.title ? `<div class="oc-rw-title">${review.title}</div>` : ''}
            <div class="oc-rw-text">${review.body || ''}</div>
          `;
        }
      };

      const openLightbox = (reviewIndex, mediaIndex) => {
        if (!lightbox) return;
        lbReviewIndex = Number(reviewIndex || 0);
        lbMediaIndex = Number(mediaIndex || 0);
        renderLightbox();
        lightbox.hidden = false;
      };

      mount.querySelectorAll('[data-rw-close-lightbox]').forEach((btn) => {
        if (btn.__rwCloseBound) return;
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (lightbox) lightbox.hidden = true;
        });
        btn.__rwCloseBound = true;
      });

      const prevBtn = mount.querySelector('[data-rw-prev]');
      if (prevBtn && !prevBtn.__rwNavBound) {
        prevBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          lbMediaIndex -= 1;
          renderLightbox();
        });
        prevBtn.__rwNavBound = true;
      }
      const nextBtn = mount.querySelector('[data-rw-next]');
      if (nextBtn && !nextBtn.__rwNavBound) {
        nextBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          lbMediaIndex += 1;
          renderLightbox();
        });
        nextBtn.__rwNavBound = true;
      }

      if (!mount.__rwDelegatedClicksBound) {
        mount.addEventListener('click', (ev) => {
          const target = ev.target instanceof Element ? ev.target : null;
          if (!target) return;
          const open = target.closest('[data-open-review-modal]');
          const close = target.closest('[data-close-review-modal]');
          const lightboxOpen = target.closest('[data-rw-open-lightbox]');
          const modalEl = mount.querySelector('[data-review-modal]');
          if (open && modalEl) {
            ev.preventDefault();
            modalEl.hidden = false;
          }
          if (close && modalEl) {
            ev.preventDefault();
            modalEl.hidden = true;
          }
          if (lightboxOpen) {
            ev.preventDefault();
            ev.stopPropagation();
            openLightbox(lightboxOpen.getAttribute('data-review-index'), lightboxOpen.getAttribute('data-media-index'));
          }

          const thumb = target.closest('[data-rw-thumb]');
          if (thumb) {
            ev.preventDefault();
            lbMediaIndex = Number(thumb.getAttribute('data-rw-thumb') || 0);
            renderLightbox();
          }
        });
        mount.__rwDelegatedClicksBound = true;
      }

      if (form) {
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
          if (successEl) successEl.hidden = true;
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

          try {
            const fd = new FormData(form);
            fd.set('shop', shop);
            fd.set('product_id', productId);
            const submitRes = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin' });
            const submitData = await submitRes.json();
            if (!submitRes.ok || !submitData?.ok) throw new Error(submitData?.error || `HTTP ${submitRes.status}`);
            form.hidden = true;
            if (successEl) successEl.hidden = false;
          } catch (err) {
            if (errorEl) {
              errorEl.hidden = false;
              errorEl.textContent = (err && err.message) ? err.message : (settings.modal_error_message || 'Failed to submit review');
            }
          } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = settings.modal_submit_label || 'Submit review'; }
          }
        });
      }

      if (!mount.innerHTML.trim()) {
        mount.innerHTML = `<div class="oc-rw-empty">Unable to load reviews widget.</div>`;
      }
    } catch (e) {
      mount.innerHTML = `<div class="oc-rw-empty">Unable to load reviews widget.</div>`;
      console.error(LOG_PREFIX, e);
    }
  });
})();
