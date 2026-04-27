import type { PropertiesPanelFieldsProps } from './propertiesPanel.types'
import { shouldUseMultilineField } from './propertiesPanel.utils'

// Renders the editable list of simple IFC properties for the currently selected element.
export const PropertiesPanelFields = ({
  propertyFields,
  onFieldChange
}: PropertiesPanelFieldsProps) => {
  return (
    <form className="properties-form">
      {propertyFields.length > 0 ? (
        propertyFields.map((field) => {
          const isLongValue = shouldUseMultilineField(field)
          return (
            <label key={field.key} className="properties-form__field">
              <span>{field.label}</span>
              {isLongValue ? (
                <textarea
                  value={field.value}
                  onChange={(event) => onFieldChange(field.key, event.target.value)}
                  rows={Math.min(6, Math.max(2, Math.ceil(field.value.length / 60)))}
                />
              ) : (
                <input
                  type="text"
                  value={field.value}
                  onChange={(event) => onFieldChange(field.key, event.target.value)}
                />
              )}
            </label>
          )
        })
      ) : (
        <p className="properties-panel__status">
          This element does not expose any simple IFC attributes.
        </p>
      )}
    </form>
  )
}
