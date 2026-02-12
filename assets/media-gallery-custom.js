if (!customElements.get('media-gallery')) {
  customElements.define(
    'media-gallery',
    class MediaGallery extends HTMLElement {
      variantChangeUnsubscriber = undefined;

      constructor() {
        super();
        this.elements = {
          liveRegion: this.querySelector('[id^="GalleryStatus"]'),
          viewer: this.querySelector('[id^="GalleryViewer"]'),
          thumbnails: this.querySelector('[id^="GalleryThumbnails"]'),
        };
        this.mql = window.matchMedia('(min-width: 750px)');
        if (!this.elements.thumbnails) return;

        this.elements.viewer.addEventListener('slideChanged', debounce(this.onSlideChanged.bind(this), 500));
        this.elements.thumbnails.querySelectorAll('[data-target]').forEach((mediaToSwitch) => {
          mediaToSwitch
            .querySelector('button')
            .addEventListener('click', this.setActiveMedia.bind(this, mediaToSwitch.dataset.target, false));
        });
        if (this.dataset.desktopLayout.includes('thumbnail') && this.mql.matches) this.removeListSemantic();
      }

      connectedCallback() {
        // Tap into Dawn variantChange event to re-order thumbnails
        if (typeof subscribe !== 'function' || typeof PUB_SUB_EVENTS === 'undefined') return;

        this.sectionId = this.id?.replace('MediaGallery-', '');
        if (!this.sectionId) return;

        this.variantChangeUnsubscriber = subscribe(PUB_SUB_EVENTS.variantChange, (event) => {
          const data = event?.data;
          if (!data || data.sectionId !== this.sectionId || !data.variant) return;
          this.reorderMediaForVariant(data.variant);
        });
      }

      disconnectedCallback() {
        // Cleanup in case gallery is removed from DOM
        if (this.variantChangeUnsubscriber) {
          this.variantChangeUnsubscriber();
        }
      }

      onSlideChanged(event) {
        const thumbnail = this.elements.thumbnails.querySelector(
          `[data-target="${event.detail.currentElement.dataset.mediaId}"]`
        );
        this.setActiveThumbnail(thumbnail);
      }

      setActiveMedia(mediaId, prepend) {
        const activeMedia =
          this.elements.viewer.querySelector(`[data-media-id="${mediaId}"]`) ||
          this.elements.viewer.querySelector('[data-media-id]');
        if (!activeMedia) {
          return;
        }
        this.elements.viewer.querySelectorAll('[data-media-id]').forEach((element) => {
          element.classList.remove('is-active');
        });
        activeMedia?.classList?.add('is-active');

        if (prepend) {
           // Extend existing behaviour from just updating the featured image to also extend to other thumbnails
          activeMedia.parentElement.firstChild !== activeMedia && activeMedia.parentElement.prepend(activeMedia);

          if (this.elements.thumbnails) {
            const activeThumbnail = this.elements.thumbnails.querySelector(`[data-target="${mediaId}"]`);
            activeThumbnail.parentElement.firstChild !== activeThumbnail &&
              activeThumbnail.parentElement.prepend(activeThumbnail);
          }

          if (this.elements.viewer.slider) this.elements.viewer.resetPages();
          if (this.elements.thumbnails?.slider) this.elements.thumbnails.resetPages();
        }

        this.preventStickyHeader();
        window.setTimeout(() => {
          if (!this.mql.matches || this.elements.thumbnails) {
            activeMedia.parentElement.scrollTo({ left: activeMedia.offsetLeft });
          }
          const activeMediaRect = activeMedia.getBoundingClientRect();
          // Don't scroll if the image is already in view
          if (activeMediaRect.top > -0.5) return;
          const top = activeMediaRect.top + window.scrollY;
          window.scrollTo({ top: top, behavior: 'smooth' });
        });
        this.playActiveMedia(activeMedia);

        if (!this.elements.thumbnails) return;
        const activeThumbnail = this.elements.thumbnails.querySelector(`[data-target="${mediaId}"]`);
        this.setActiveThumbnail(activeThumbnail);
        this.announceLiveRegion(activeMedia, activeThumbnail.dataset.mediaPosition);
      }

      setActiveThumbnail(thumbnail) {
        if (!this.elements.thumbnails || !thumbnail) return;

        this.elements.thumbnails
          .querySelectorAll('button')
          .forEach((element) => element.removeAttribute('aria-current'));
        thumbnail.querySelector('button').setAttribute('aria-current', true);
        if (this.elements.thumbnails.isSlideVisible(thumbnail, 10)) return;

        this.elements.thumbnails.slider.scrollTo({ left: thumbnail.offsetLeft });
      }

      announceLiveRegion(activeItem, position) {
        const image = activeItem.querySelector('.product__modal-opener--image img');
        if (!image) return;
        image.onload = () => {
          this.elements.liveRegion.setAttribute('aria-hidden', false);
          this.elements.liveRegion.innerHTML = window.accessibilityStrings.imageAvailable.replace('[index]', position);
          setTimeout(() => {
            this.elements.liveRegion.setAttribute('aria-hidden', true);
          }, 2000);
        };
        image.src = image.src;
      }

      playActiveMedia(activeItem) {
        window.pauseAllMedia();
        const deferredMedia = activeItem.querySelector('.deferred-media');
        if (deferredMedia) deferredMedia.loadContent(false);
      }

      preventStickyHeader() {
        this.stickyHeader = this.stickyHeader || document.querySelector('sticky-header');
        if (!this.stickyHeader) return;
        this.stickyHeader.dispatchEvent(new Event('preventHeaderReveal'));
      }

      removeListSemantic() {
        if (!this.elements.viewer.slider) return;
        this.elements.viewer.slider.setAttribute('role', 'presentation');
        this.elements.viewer.sliderItems.forEach((slide) => slide.setAttribute('role', 'presentation'));
      }

      reorderMediaForVariant(variant) {
        // Match all option values against alt tags (expected format: 'Product Name - Color - Description')
        if (!this.elements.thumbnails || !this.elements.viewer || !variant) return;

        const optionValues = [];
        if (Array.isArray(variant.options)) {
          optionValues.push(...variant.options);
        }
        ['option1', 'option2', 'option3'].forEach((key) => {
          if (variant[key]) optionValues.push(variant[key]);
        });

        // Control for missing/null/tags and casing
        const normalizedOptions = optionValues
          .filter(Boolean)
          .map((value) => value.toString().trim().toLowerCase())
          .filter((value, index, self) => self.indexOf(value) === index);

        if (!normalizedOptions.length) return;

        const thumbnailList = this.elements.thumbnails.querySelector('ul[id^="Slider-Thumbnails"]');
        if (!thumbnailList) return;

        const allThumbnails = Array.from(thumbnailList.querySelectorAll('[data-target]'));
        if (!allThumbnails.length) return;

        // Sort thumbnails into separate arrays for relevant vs other
        const relevantThumbnails = [];
        const otherThumbnails = [];
        const relevantMediaIds = new Set();

        allThumbnails.forEach((thumbnail) => {
          const img = thumbnail.querySelector('img');
          const alt = img?.alt || '';
          const parts = alt.split(' - ');
          const colorPart = parts.length > 1 ? parts[1].trim().toLowerCase() : null;

          const isRelevant = colorPart && normalizedOptions.includes(colorPart);

          if (isRelevant) {
            relevantThumbnails.push(thumbnail);
            relevantMediaIds.add(thumbnail.dataset.target);
          } else {
            otherThumbnails.push(thumbnail);
          }
        });

        if (!relevantThumbnails.length) return;

        const reorderedThumbnails = [...relevantThumbnails, ...otherThumbnails];
        reorderedThumbnails.forEach((thumbnail) => {
          // Recombine thumbs - relevant first then other 
          thumbnailList.appendChild(thumbnail);
        });

        const viewerList = this.elements.viewer.querySelector('ul[id^="Slider-Gallery"]');
        if (viewerList) {
          // Repeat relevant-other logic for slides
          const allSlides = Array.from(viewerList.querySelectorAll('li[data-media-id]'));
          const relevantSlides = [];
          const otherSlides = [];

          allSlides.forEach((slide) => {
            const mediaId = slide.dataset.mediaId;
            if (relevantMediaIds.has(mediaId)) {
              relevantSlides.push(slide);
            } else {
              otherSlides.push(slide);
            }
          });

          if (relevantSlides.length) {
            const reorderedSlides = [...relevantSlides, ...otherSlides];
            reorderedSlides.forEach((slide) => {
              viewerList.appendChild(slide);
            });

            // Call resetPages to maintain slider pagination & offsets
            if (this.elements.viewer.slider) this.elements.viewer.resetPages();
          }
        }

        if (this.elements.thumbnails.slider) this.elements.thumbnails.resetPages();
      } 
    }
  );
}