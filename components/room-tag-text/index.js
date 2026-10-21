// components/room-tag-text/index.js · 同寝室标识（恒大写 A…Z/AA…）
const roomTag = require('../../utils/room-tag');

Component({
  properties: {
    dormKey: { type: String, value: '' },
    tag: { type: String, value: '' }
  },

  data: {
    text: ''
  },

  observers: {
    'dormKey, tag'(dormKey, tag) {
      let text = '';
      if (dormKey && tag) {
        text = typeof roomTag.formatDormTag === 'function'
          ? roomTag.formatDormTag(dormKey, tag)
          : dormKey + tag;
      }
      this.setData({ text });
    }
  }
});
