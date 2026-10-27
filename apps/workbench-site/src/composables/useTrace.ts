import { onMounted, onUnmounted, watch, type Ref } from "vue";

type Point = { x: number; y: number };

const handoffKeyframes = ({ start, end, radius }: { start: Point; end: Point; radius: number }) => {
  const reverse = end.y < start.y;
  const [upper, lower] = reverse ? [end, start] : [start, end];
  // Construct the downward fork/merge path once, then traverse it in either direction.
  // Matches CommitBranch: a merge from the branch lane (right) curves just below its node,
  // and a fork onto the branch lane curves just above the branch node.
  const route =
    upper!.x > lower!.x
      ? `M${upper!.x} ${upper!.y} C${upper!.x} ${upper!.y + 26} ${lower!.x} ${upper!.y + 14} ${lower!.x} ${upper!.y + 48} V${lower!.y}`
      : `M${upper!.x} ${upper!.y} V${lower!.y - 36} C${upper!.x} ${lower!.y - 14} ${lower!.x} ${lower!.y - 26} ${lower!.x} ${lower!.y}`;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", route);
  const length = path.getTotalLength();
  return Array.from({ length: 33 }, (_, index) => {
    const distance = (length * index) / 32;
    const position = path.getPointAtLength(reverse ? length - distance : distance);
    return {
      transform: `translate(${position.x - radius}px, ${position.y - radius}px)`,
      opacity: index === 0 || index === 32 ? 0 : 1,
    };
  });
};

export const useTrace = ({
  main,
  activeId,
}: {
  main: Readonly<Ref<HTMLElement | null>>;
  activeId: Readonly<Ref<string | undefined>>;
}) => {
  let cleanup: (() => void) | undefined;
  let updateTrace: (() => void) | undefined;
  watch(activeId, () => updateTrace?.());

  onMounted(() => {
    const container = main.value;
    if (!container) return;
    const sections = [...container.querySelectorAll<HTMLElement>("[data-trace-section]")];
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const narrow = matchMedia("(max-width: 1000px)");
    const packet = document.createElement("span");
    packet.className = "trace-packet";
    packet.setAttribute("aria-hidden", "true");
    container.append(packet);
    const tokens = getComputedStyle(packet);
    const durationToken = tokens.getPropertyValue("--duration-section").trim();
    const duration = parseFloat(durationToken) * (durationToken.endsWith("ms") ? 1 : 1000);
    const easing = tokens.getPropertyValue("--ease-out").trim();
    let active = sections[0];
    active?.classList.add("is-current");

    const stopMotion = () => {
      packet.getAnimations().forEach((animation) => animation.cancel());
      sections.forEach((section) => {
        section.classList.remove("trace-arriving");
        section
          .querySelector(".commit-junction")
          ?.getAnimations({ subtree: true })
          .forEach((animation) => animation.cancel());
      });
    };
    const travel = (previous: HTMLElement, next: HTMLElement) => {
      if (reducedMotion.matches || narrow.matches) return;
      const nodes = [previous, next].map((section) => section.querySelector(".commit-node"));
      if (nodes.some((node) => !node)) return;
      const origin = container.getBoundingClientRect();
      const points = nodes.map((node) => {
        const bounds = node!.getBoundingClientRect();
        return {
          x: bounds.left + bounds.width / 2 - origin.left,
          y: bounds.top + bounds.height / 2 - origin.top,
        };
      });
      packet.animate(
        handoffKeyframes({ start: points[0]!, end: points[1]!, radius: packet.offsetWidth / 2 }),
        { duration, easing },
      );
    };
    updateTrace = () => {
      const current = sections.find(
        (section) => section.getAttribute("aria-labelledby") === activeId.value,
      );
      if (!current || current === active) return;
      stopMotion();
      // A deep-link jump settles at its destination rather than cutting across branches.
      if (Math.abs(sections.indexOf(current) - sections.indexOf(active!)) === 1)
        travel(active!, current);
      sections.forEach((section) => {
        section.classList.toggle("is-current", section === current);
        section.classList.toggle("trace-arriving", section === current);
      });
      active = current;
    };
    reducedMotion.addEventListener("change", stopMotion);
    window.addEventListener("resize", stopMotion);
    const layoutObserver = new ResizeObserver(stopMotion);
    layoutObserver.observe(container);
    updateTrace();
    cleanup = () => {
      updateTrace = undefined;
      stopMotion();
      layoutObserver.disconnect();
      reducedMotion.removeEventListener("change", stopMotion);
      window.removeEventListener("resize", stopMotion);
      packet.remove();
      sections.forEach((section) => section.classList.remove("is-current"));
    };
  });
  onUnmounted(() => cleanup?.());
};
