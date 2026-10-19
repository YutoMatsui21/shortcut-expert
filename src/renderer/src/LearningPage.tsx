import { Fragment } from 'react';
import { learningGroups, learningOperations, type LearningReadModel, type LearningState } from '../../shared/learning';
import { Icon, type IconName } from './icons';

const states: { value: LearningState; label: string; icon: IconName }[] = [
  { value: 'learning', label: '学習中', icon: 'imgStatusIcon' },
  { value: 'mastered', label: '習得済み', icon: 'imgStatusIcon1' },
  { value: 'excluded', label: '対象外', icon: 'imgStatusIcon2' }
];
export function LearningSummary({ model }: { model?: LearningReadModel }) {
  return <div className="learning-summary">{states.map(state => <span key={state.value} className={'status ' + state.value}>
    <Icon name={state.icon} />{state.label} <span>{model ? model.rows.filter(row => row.state === state.value).length : '—'}</span>
  </span>)}</div>;
}
export function LearningPage({ model, collapsed, toggle }: { model?: LearningReadModel; collapsed: number[]; toggle(group: number): void }) {
  return <div className="learning-content">{learningGroups.map((group, index) => <section className="learning-group" key={group.label}>
    <button className="group-header" aria-expanded={!collapsed.includes(index)} aria-controls={'learning-group-' + index} onClick={() => toggle(index)}>
      <Icon name={group.icon} /><span>{group.label}</span><Icon name={collapsed.includes(index) ? 'imgChevronVector1' : 'imgChevronVector'} />
    </button>
    <div className="learning-rows" id={'learning-group-' + index} hidden={collapsed.includes(index)}>
      {learningOperations.filter(operation => operation.group === index).map(operation => {
        const row = model?.rows.find(row => row.id === operation.id);
        const state = states.find(state => state.value === row?.state) ?? states[0];
        return <div className="learning-row" key={operation.id} data-learning-operation={operation.id}>
          <div className="operation-copy"><div className="operation-label">{operation.label}</div><div className="rate-line">
            <span className="key-rate">キー率：{row?.rate == null ? '—' : row.rate.toFixed(1) + '%'} {row?.total == null ? '記録なし' : `（${row.key}/${row.total}）`}</span>
            <span className="help" tabIndex={0} role="note" aria-label="キー率の計算方法"><Icon name="imgHelpIconHover" /><span className="tooltip">直近7日間のキー操作回数 ÷（キー操作回数＋マウス操作回数）。記録なしと0%は区別します。</span></span>
            <span className="availability">準備中</span>
          </div></div>
          <div className="shortcut-keys" aria-label={operation.hint ?? operation.keys.join(' + ')} title={operation.hint}>
            {operation.keys.map((key, i) => <Fragment key={key}>{i > 0 && <span className="key-plus">+</span>}<kbd>{key}</kbd></Fragment>)}
          </div>
          <span className={'status row-status ' + state.value} title="学習状態の変更は準備中です。旧版の通知OFFは対象外として表示します。">
            <Icon name={state.value === 'excluded' ? 'imgStatusIcon4' : 'imgStatusIcon3'} /><span>{row ? state.label : '—'}</span><Icon name="imgChevronVector1" />
          </span>
        </div>;
      })}
    </div>
  </section>)}</div>;
}
