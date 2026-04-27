import type { PropertiesPanelHistoryProps } from './propertiesPanel.types'
import { formatHistoryTimestamp } from './propertiesPanel.utils'

// Renders the history list for the currently selected element.
export const PropertiesPanelHistory = ({
  historyEntries
}: PropertiesPanelHistoryProps) => {
  return (
    <div className="history-panel">
      <div className="history-panel__header">
        <h3>History</h3>
      </div>
      {historyEntries.length > 0 ? (
        <ul className="history-panel__list">
          {historyEntries.map((entry, index) => (
            <li key={`${entry.timestamp}-${index}`} className="history-panel__item">
              <span className="history-panel__label">{entry.label}</span>
              <span className="history-panel__time">{formatHistoryTimestamp(entry)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="properties-panel__status">No history yet.</p>
      )}
    </div>
  )
}
