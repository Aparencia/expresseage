// components/code-editor/index.js · 行内编辑（取件码/柜号/运单尾号；校验走 shared/validate）
Component({
  properties: {
    value: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    maxlength: { type: Number, value: 40 }
  },

  methods: {
    onInput(event) {
      const value = (event.detail && event.detail.value) || '';
      this.triggerEvent('change', { value });
    },

    onBlur(event) {
      const value = (event.detail && event.detail.value) || this.data.value;
      this.triggerEvent('blur', { value });
    }
  }
});
