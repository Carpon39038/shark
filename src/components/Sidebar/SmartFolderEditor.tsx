import { useState, useEffect } from 'react';
import {
  type SmartFolder,
  type RuleGroup,
  type Condition,
  type FieldType,
  FIELD_KINDS,
  FIELD_LABELS,
  OPERATORS_BY_KIND,
  FILE_TYPE_OPERATORS,
} from '@/lib/types';
import { useSmartFolderStore } from '@/stores/smartFolderStore';
import { invoke } from '@tauri-apps/api/core';
import { TextInput } from '@/components/ui/TextInput';
import { Select } from '@/components/ui/Select';

interface SmartFolderEditorProps {
  folder?: SmartFolder | null; // null = create new
  onClose: () => void;
}

const ALL_FIELDS: FieldType[] = [
  'file_name',
  'file_type',
  'file_size',
  'width',
  'height',
  'tags',
  'rating',
  'notes',
  'created_at',
  'modified_at',
];

function getDefaultCondition(): Condition {
  return { field: 'rating', op: 'gte', value: 0 };
}

function getOperatorsForField(field: FieldType) {
  if (field === 'file_type') return FILE_TYPE_OPERATORS;
  return OPERATORS_BY_KIND[FIELD_KINDS[field]];
}

export function SmartFolderEditor({ folder, onClose }: SmartFolderEditorProps) {
  const { create, update } = useSmartFolderStore();
  const [name, setName] = useState(folder?.name ?? '');
  const [operator, setOperator] = useState<'AND' | 'OR'>(
    folder ? (JSON.parse(folder.rules).operator ?? 'AND') : 'AND',
  );
  const [conditions, setConditions] = useState<Condition[]>(
    folder ? (JSON.parse(folder.rules).conditions ?? [getDefaultCondition()]) : [getDefaultCondition()],
  );
  const [saving, setSaving] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    setCalculating(true);
    const timer = setTimeout(async () => {
      try {
        const rulesJson = JSON.stringify({ operator, conditions });
        const count = await invoke<number>('preview_smart_folder', { rules: rulesJson });
        setMatchCount(count);
      } catch {
        setMatchCount(null);
      } finally {
        setCalculating(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [operator, conditions]);

  const addCondition = () => {
    setConditions([...conditions, getDefaultCondition()]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, patch: Partial<Condition>) => {
    setConditions(
      conditions.map((c, i) => {
        if (i !== index) return c;
        const updated = { ...c, ...patch };
        // Reset value when field changes
        if (patch.field && patch.field !== c.field) {
          updated.value = FIELD_KINDS[patch.field as FieldType] === 'number' ? 0 : '';
        }
        // Reset op when field changes
        if (patch.field && patch.field !== c.field) {
          const ops = getOperatorsForField(patch.field as FieldType);
          if (!ops.some((o) => o.value === updated.op)) {
            updated.op = ops[0].value;
          }
        }
        return updated;
      }),
    );
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const rules: RuleGroup = { operator, conditions };
    try {
      if (folder) {
        await update(folder.id, name.trim(), rules);
      } else {
        await create(name.trim(), rules);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white border border-[#E5E5E5] rounded-lg shadow-xl w-[480px] max-h-[80vh] overflow-y-auto">
        <div className="p-4">
          <h2 className="text-lg font-semibold text-[#1D1D1F] mb-4">
            {folder ? 'Edit Smart Folder' : 'New Smart Folder'}
          </h2>

          {/* Name */}
          <label className="block text-[13px] text-[#666666] mb-1">Name</label>
          <TextInput
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mb-4"
            placeholder="e.g. Best Photos"
          />

          {/* Match operator */}
          <label className="block text-[13px] text-[#666666] mb-1">Match</label>
          <Select
            value={operator}
            onChange={(e) => setOperator(e.target.value as 'AND' | 'OR')}
            className="mb-3"
          >
            <option value="AND">ALL conditions</option>
            <option value="OR">ANY condition</option>
          </Select>

          {/* Conditions */}
          <div className="space-y-2 mb-3">
            {conditions.map((cond, i) => (
              <ConditionRow
                key={i}
                condition={cond}
                onChange={(patch) => updateCondition(i, patch)}
                onRemove={() => removeCondition(i)}
                showRemove={conditions.length > 1}
              />
            ))}
          </div>

          <button
            onClick={addCondition}
            className="text-[13px] text-[#0063E1] hover:text-[#0052CC] mb-4"
          >
            + Add Condition
          </button>

          {/* Match count preview */}
          {(calculating || matchCount !== null) && (
            <div className="text-[13px] text-[#0063E1] mb-4">
              {calculating ? '正在计算...' : `匹配 ${matchCount} 个项目`}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-[13px] text-[#666666] hover:text-[#1D1D1F]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="px-4 py-1.5 text-[13px] bg-[#0063E1] text-white rounded-md hover:bg-[#0052CC] disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors duration-150"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
  showRemove,
}: {
  condition: Condition;
  onChange: (patch: Partial<Condition>) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  const fieldType = condition.field as FieldType;
  const kind = FIELD_KINDS[fieldType] ?? 'text';
  const operators = getOperatorsForField(fieldType);

  return (
    <div className="flex items-center gap-2">
      {/* Field selector */}
      <Select
        value={condition.field}
        onChange={(e) => onChange({ field: e.target.value })}
      >
        {ALL_FIELDS.map((f) => (
          <option key={f} value={f}>
            {FIELD_LABELS[f]}
          </option>
        ))}
      </Select>

      {/* Operator selector */}
      <Select
        value={condition.op}
        onChange={(e) => onChange({ op: e.target.value })}
      >
        {operators.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      {/* Value input(s) */}
      {condition.op === 'between' ? (
        <div className="flex gap-1">
          <TextInput
            type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
            value={Array.isArray(condition.value) ? condition.value[0] ?? '' : ''}
            onChange={(e) => {
              const arr = Array.isArray(condition.value) ? [...condition.value] : ['', ''];
              arr[0] = kind === 'number' ? Number(e.target.value) : e.target.value;
              onChange({ value: arr });
            }}
            className="w-20"
          />
          <span className="text-[#999999] self-center">~</span>
          <TextInput
            type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
            value={Array.isArray(condition.value) ? condition.value[1] ?? '' : ''}
            onChange={(e) => {
              const arr = Array.isArray(condition.value) ? [...condition.value] : ['', ''];
              arr[1] = kind === 'number' ? Number(e.target.value) : e.target.value;
              onChange({ value: arr });
            }}
            className="w-20"
          />
        </div>
      ) : condition.op === 'in' || condition.op === 'not_in' ? (
        <TextInput
          type="text"
          value={Array.isArray(condition.value) ? condition.value.join(', ') : ''}
          onChange={(e) => {
            const vals = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            onChange({ value: vals });
          }}
          placeholder="JPG, PNG, ..."
          className="flex-1"
        />
      ) : (
        <TextInput
          type={kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text'}
          value={condition.value as string | number}
          onChange={(e) =>
            onChange({
              value: kind === 'number' ? Number(e.target.value) : e.target.value,
            })
          }
          className="flex-1"
        />
      )}

      {/* Remove button */}
      {showRemove && (
        <button
          onClick={onRemove}
          className="text-[#999999] hover:text-[#FF3B30] text-[13px]"
        >
          x
        </button>
      )}
    </div>
  );
}
