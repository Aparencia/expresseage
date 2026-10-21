// components/form-field/index.js · 表单行（标签 + 输入；校验与错误文案由调用方给）
Component({
  properties: {
    label: { type: String, value: '' },
    value: { type: String, value: '' },
    type: { type: String, value: 'text' },
    placeholder: { type: String, value: '' },
    required: { type: Boolean, value: false },
    maxlength: { type: Number, value: 200 },
    error: { type: String, value: '' }
  },

  methods: {
    onInput(event) {
      this.triggerEvent('change', { value: (event.detail && event.detail.value) || '' });
    }
  }
});
