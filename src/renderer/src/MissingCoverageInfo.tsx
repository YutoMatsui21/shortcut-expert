import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export function MissingCoverageInfo({ label }: { label: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const close = () => {
    clearTimeout(timer.current);
    pinned.current = false;
    setOpen(false);
  };
  const leave = () => {
    timer.current = setTimeout(() => {
      if (!pinned.current && document.activeElement !== button.current)
        setOpen(false);
    }, 100);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!button.current || !tooltip.current) return;
      const anchor = button.current.getBoundingClientRect(),
        box = tooltip.current.getBoundingClientRect();
      if (
        anchor.width === 0 ||
        anchor.bottom < 32 ||
        anchor.top > innerHeight
      ) {
        close();
        return;
      }
      setPosition({
        left: Math.max(
          8,
          Math.min(anchor.right - box.width / 2, innerWidth - box.width - 8),
        ),
        top:
          anchor.bottom + 8 + box.height <= innerHeight - 8
            ? anchor.bottom + 8
            : Math.max(8, anchor.top - box.height - 8),
      });
    };
    place();
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !button.current?.contains(event.target) &&
        !tooltip.current?.contains(event.target)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="coverage-info"
        aria-label={label + "：記録の欠損について"}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={leave}
        onFocus={show}
        onBlur={() => {
          if (!pinned.current) close();
        }}
        onClick={() => {
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}
      >
        <Icon name="imgInfoIcon" />
      </button>
      {open && (
        <span
          ref={tooltip}
          id={id}
          role="tooltip"
          className="coverage-tooltip"
          style={position}
          onMouseEnter={show}
          onMouseLeave={leave}
        >
          一部の時間帯で記録を取得できていないため、
          <br />
          実際の利用状況と異なる可能性があります。
        </span>
      )}
    </>
  );
}
