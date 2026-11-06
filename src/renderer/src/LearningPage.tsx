import { Fragment } from "react";
import type { OperationId } from "../../shared/coach";
import {
  learningGroups,
  learningOperations,
  type LearningReadModel,
  type LearningState,
} from "../../shared/learning";
import { isLearningState } from "../../shared/learning";
import { Icon, type IconName } from "./icons";

const states: { value: LearningState; label: string; icon: IconName }[] = [
  { value: "learning", label: "学習中", icon: "imgStatusIcon" },
  { value: "mastered", label: "習得済み", icon: "imgStatusIcon1" },
  { value: "excluded", label: "対象外", icon: "imgStatusIcon2" },
];
export function LearningSummary({ model }: { model?: LearningReadModel }) {
  return (
    <div className="learning-summary">
      {states.map((state) => (
        <span key={state.value} className={"status " + state.value}>
          <Icon name={state.icon} />
          {state.label}{" "}
          <span>
            {model
              ? model.rows.filter((row) => row.state === state.value).length
              : "ー"}
          </span>
        </span>
      ))}
    </div>
  );
}
export function LearningPage({
  model,
  collapsed,
  toggle,
  busy,
  change,
}: {
  model?: LearningReadModel;
  collapsed: number[];
  toggle(group: number): void;
  busy: boolean;
  change(id: OperationId, state: LearningState): Promise<void>;
}) {
  return (
    <div className="learning-content">
      {learningGroups.map((group, index) => (
        <section className="learning-group" key={group.label}>
          <button
            className="group-header"
            aria-expanded={!collapsed.includes(index)}
            aria-controls={"learning-group-" + index}
            onClick={() => toggle(index)}
          >
            <Icon name={group.icon} />
            <span>{group.label}</span>
            <Icon
              name={
                collapsed.includes(index)
                  ? "imgChevronVector1"
                  : "imgChevronVector"
              }
            />
          </button>
          <div
            className="learning-rows"
            id={"learning-group-" + index}
            hidden={collapsed.includes(index)}
          >
            {learningOperations
              .filter((operation) => operation.group === index)
              .map((operation) => {
                const row = model?.rows.find((row) => row.id === operation.id);
                const state =
                  states.find((state) => state.value === row?.state) ??
                  states[0];
                return (
                  <div
                    className="learning-row"
                    key={operation.id}
                    data-learning-operation={operation.id}
                  >
                    <div className="operation-copy">
                      <div className="operation-label">{operation.label}</div>
                      <div className="rate-line">
                        <span className="key-rate">
                          キー率：
                          {row?.rate == null
                            ? "ー"
                            : row.rate.toFixed(1) + "%"}{" "}
                          {row?.total == null
                            ? "記録なし"
                            : `（${row.key}/${row.total}）`}
                        </span>
                      </div>
                    </div>
                    <div
                      className="shortcut-keys"
                      aria-label={operation.hint ?? operation.keys.join(" + ")}
                      title={operation.hint}
                    >
                      {operation.keys.map((key, i) => (
                        <Fragment key={key}>
                          {i > 0 && <span className="key-plus">+</span>}
                          <kbd>{key}</kbd>
                        </Fragment>
                      ))}
                    </div>
                    <span className={"status row-status " + state.value}>
                      <Icon name={state.icon} />
                      <span>{row ? state.label : "ー"}</span>
                      <Icon name="imgChevronVector1" />
                      <select
                        aria-label={operation.label + "の学習状態"}
                        value={state.value}
                        disabled={busy || !row}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (isLearningState(value))
                            void change(operation.id, value);
                        }}
                      >
                        {states.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </span>
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
