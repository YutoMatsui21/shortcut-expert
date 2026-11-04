// Experiment seam: resolve input candidates, never assert causal certainty.
public sealed class InputOriginCandidate
{
    long inputAt = -10000;
    string kind = "unknown";
    bool injected;
    bool caption,
        moveActive,
        dragMouse;

    public void MouseDown(long now, bool isInjected, bool onCaption)
    {
        inputAt = now;
        kind = "mouse";
        injected = isInjected;
        caption = onCaption;
        if (moveActive)
            dragMouse = false;
    }

    public void KeyDown(long now, bool isInjected)
    {
        inputAt = now;
        kind = "key";
        injected = isInjected;
        caption = false;
        if (moveActive)
            dragMouse = false;
    }

    public void BeginMoveSize(long now)
    {
        moveActive = true;
        dragMouse =
            kind == "mouse" && caption && !injected && now - inputAt >= 0 && now - inputAt <= 1000;
    }

    public void EndMoveSize()
    {
        moveActive = false;
        dragMouse = false;
        inputAt = -10000;
        kind = "unknown";
    }

    public string Resolve(long now)
    {
        if (moveActive)
            return dragMouse ? "drag-mouse" : "unknown";
        return now - inputAt >= 0 && now - inputAt <= 1000 && !injected
            ? "nearby-" + kind
            : "unknown";
    }
}
