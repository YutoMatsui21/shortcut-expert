export const windowDiagnosticKeys = ['MouseDown', 'MouseUp', 'TargetMissing', 'TargetRejected', 'RawCaption', 'RawClient', 'RawButton', 'RawOther',
  'TitleReadOk', 'TitleReadFail', 'TitleContainsPoint', 'TitleOutsidePoint', 'FinalCaption', 'FinalButton', 'FinalOther',
  'ForegroundMatched', 'ForegroundOther', 'MoveStart', 'MoveEnd',
  'HitRoot', 'HitChildSameProcess', 'HitChildUnmatched', 'ChildCaption', 'ChildClient', 'ChildOther', 'ChildHitFailed',
  'ChildTitleContainsPoint', 'ChildTitleOutsidePoint', 'ChildTitleReadFail',
  'DragNoSource', 'DragNoResult', 'DragTargetChanged', 'DragLayoutChanged', 'DragMonitorUnknown', 'DragReleaseUnknown', 'DragArrangedResult',
  'DragForegroundCancelled', 'DragInputCancelled',
  'PlacementInputUnmatched', 'PlacementIncompatible', 'PlacementStartInvalid', 'PlacementShapeUnknown',
  'PlacementReleaseMonitorMismatch', 'PlacementReleaseWorkMismatch', 'PlacementStartAgeInvalid', 'PlacementGeometryChanged',
  'PlacementSideWithin2', 'PlacementSide3To8', 'PlacementSide9To32', 'PlacementSideAbove32', 'PlacementYOutside',
  'PlacementVerticalMismatch', 'PlacementAccepted',
  'ShapeInputInvalid', 'ShapeLeftEdge', 'ShapeRightEdge', 'ShapeLeftEndAtMid', 'ShapeRightStartAtMid',
  'ShapeTop', 'ShapeBottom', 'ShapeMidStart', 'ShapeMidEnd',
  'DragMaximizedResult', 'MoveSameMonitor', 'MoveReleaseMonitorMismatch', 'MoveReleaseWorkMismatch', 'MoveEndStateInvalid', 'MoveUnstable', 'MoveInputInvalid', 'MoveForegroundMismatch', 'MoveAccepted'] as const;
export type WindowDiagnosticCounts = Record<typeof windowDiagnosticKeys[number], number>;
export function parseWindowDiagnostics(value: unknown): WindowDiagnosticCounts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== windowDiagnosticKeys.length || Object.keys(raw).some(key => !windowDiagnosticKeys.some(allowed => allowed === key)) ||
    windowDiagnosticKeys.some(key => !Object.hasOwn(raw, key) || !Number.isInteger(raw[key]) || Number(raw[key]) < 0 || Number(raw[key]) > 1000)) return null;
  return Object.fromEntries(windowDiagnosticKeys.map(key => [key, Number(raw[key])])) as WindowDiagnosticCounts;
}
