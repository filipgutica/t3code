import { onMounted, onUnmounted, type Ref } from "vue";
export const useTrace = (main: Readonly<Ref<HTMLElement | null>>) => {
  let cleanup: (() => void) | undefined;
  onMounted(() => {
    const sections = [...(main.value?.querySelectorAll<HTMLElement>("[data-trace-section]") ?? [])];
    const footer = document.querySelector<HTMLElement>(".site-footer");

    if ("IntersectionObserver" in window) {
      const container = main.value;
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      const narrow = matchMedia("(max-width: 800px)");
      const packet = document.createElement("span");
      packet.className = "trace-packet";
      packet.setAttribute("aria-hidden", "true");
      container?.append(packet);
      const tokens = getComputedStyle(packet);
      const durationToken = tokens.getPropertyValue("--duration-section").trim();
      const duration = parseFloat(durationToken) * (durationToken.endsWith("ms") ? 1 : 1000);
      const easing = tokens.getPropertyValue("--ease-out").trim();
      let activeIndex = -1;

      const travel = (previous: HTMLElement, next: HTMLElement) => {
        if (!container || reducedMotion.matches || narrow.matches) return;
        const origin = container.getBoundingClientRect();
        const point = (section: HTMLElement) => {
          const node = section.querySelector(".commit-node")?.getBoundingClientRect();
          return node
            ? {
                x: node.left + node.width / 2 - origin.left,
                y: node.top + node.height / 2 - origin.top,
              }
            : null;
        };
        const start = point(previous);
        const end = point(next);
        if (!start || !end) return;
        const direction = end.y > start.y ? 1 : -1;
        // Match CommitBranch's control points so the packet stays on the fork/merge stroke in either direction.
        let route = `M${start.x} ${start.y} L${end.x} ${end.y}`;
        if (start.x !== end.x) {
          if (direction > 0) {
            route =
              end.x < start.x
                ? `M${start.x} ${start.y} V${end.y - 36} C${start.x} ${end.y - 14} ${end.x} ${end.y - 26} ${end.x} ${end.y}`
                : `M${start.x} ${start.y} C${start.x} ${start.y + 26} ${end.x} ${start.y + 14} ${end.x} ${start.y + 48} V${end.y}`;
          } else {
            route =
              end.x < start.x
                ? `M${start.x} ${start.y} V${end.y + 48} C${start.x} ${end.y + 14} ${end.x} ${end.y + 26} ${end.x} ${end.y}`
                : `M${start.x} ${start.y} C${start.x} ${start.y - 26} ${end.x} ${start.y - 14} ${end.x} ${start.y - 36} V${end.y}`;
          }
        }
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", route);
        const length = path.getTotalLength();
        const radius = packet.offsetWidth / 2;
        const keyframes = Array.from({ length: 33 }, (_, index) => {
          const position = path.getPointAtLength((length * index) / 32);
          return {
            transform: `translate(${position.x - radius}px, ${position.y - radius}px)`,
            opacity: index === 0 || index === 32 ? 0 : 1,
          };
        });
        packet.animate(keyframes, { duration, easing });
      };

      const updateTrace = () => {
        const focusY = window.innerHeight * 0.5;
        const nearest = sections.reduce(
          (nearest, section, index) => {
            const { top, bottom } = section.getBoundingClientRect();
            const distance = Math.max(top - focusY, focusY - bottom, 0);
            return distance < nearest.distance ? { index, distance } : nearest;
          },
          { index: 0, distance: Infinity },
        ).index;
        const footerVisible = footer && footer.getBoundingClientRect().top < window.innerHeight;
        const current = footerVisible ? sections.length - 1 : nearest;
        if (current === activeIndex) return;
        packet.getAnimations().forEach((animation) => animation.cancel());
        // A section-link jump can cross several forks; settle at the destination instead of cutting across the graph.
        if (activeIndex >= 0 && Math.abs(current - activeIndex) === 1)
          travel(sections[activeIndex], sections[current]);
        sections.forEach((section, index) => {
          section.classList.toggle("is-current", index === current);
          section.classList.toggle("trace-arriving", activeIndex >= 0 && index === current);
        });
        activeIndex = current;
      };

      const stopMotion = () => {
        packet.getAnimations().forEach((animation) => animation.cancel());
        sections.forEach((section) => section.classList.remove("trace-arriving"));
      };
      reducedMotion.addEventListener("change", stopMotion);

      let observer: IntersectionObserver;
      let focusObserver: IntersectionObserver;
      const observeSections = () => {
        packet.getAnimations().forEach((animation) => animation.cancel());
        observer?.disconnect();
        focusObserver?.disconnect();
        const upperInset = Math.floor(window.innerHeight * 0.15);
        const lowerInset = Math.floor(window.innerHeight * 0.3);
        observer = new IntersectionObserver(updateTrace, {
          rootMargin: `-${upperInset}px 0px -${lowerInset}px 0px`,
        });
        const focusHeight = 4;
        // Clamp so a tiny or zero-height viewport cannot produce a negative inset ("--2px" is an invalid rootMargin).
        const focusTop = Math.max(0, Math.floor((window.innerHeight - focusHeight) / 2));
        const focusBottom = Math.max(0, window.innerHeight - focusTop - focusHeight);
        focusObserver = new IntersectionObserver(updateTrace, {
          rootMargin: `-${focusTop}px 0px -${focusBottom}px 0px`,
        });
        sections.forEach((section) => {
          observer.observe(section);
          focusObserver.observe(section);
        });
        updateTrace();
      };

      window.addEventListener("resize", observeSections);
      const footerObserver = new IntersectionObserver(updateTrace);
      if (footer) footerObserver.observe(footer);
      const layoutObserver = new ResizeObserver(updateTrace);
      if (container) layoutObserver.observe(container);
      cleanup = () => {
        observer?.disconnect();
        focusObserver?.disconnect();
        footerObserver.disconnect();
        layoutObserver.disconnect();
        window.removeEventListener("resize", observeSections);
        reducedMotion.removeEventListener("change", stopMotion);
        packet.getAnimations().forEach((animation) => animation.cancel());
        packet.remove();
        sections.forEach((section) => section.classList.remove("is-current", "trace-arriving"));
      };
      observeSections();
    }
  });
  onUnmounted(() => cleanup?.());
};
