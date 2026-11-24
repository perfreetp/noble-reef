/** 组件共享设计令牌(Shadow DOM 内各自注入) */
export const sharedCss = `
:host {
  --bg: #141118;
  --panel: #1d1922;
  --panel-2: #262029;
  --line: #38303d;
  --text: #ece5f0;
  --muted: #9a8fa3;
  --accent: #66e1ff;
  --gold: #e8c169;
  --danger: #ff7a6b;
  --ok: #8be36b;
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  color: var(--text);
  font-size: 13px;
  box-sizing: border-box;
}
* { box-sizing: border-box; }
button {
  font: inherit;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
button:hover { border-color: var(--accent); }
button.primary {
  background: linear-gradient(135deg, #1d6f82, #2a97ab);
  border-color: #3bb7cc;
  color: #f2fdff;
  font-weight: 600;
}
button.primary:hover { filter: brightness(1.1); }
input, select {
  font: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 5px 8px;
  width: 100%;
}
input[type="range"] { padding: 0; }
label { color: var(--muted); display: block; margin-bottom: 4px; font-size: 12px; }
.row { display: flex; gap: 10px; align-items: center; }
.field { margin-bottom: 10px; }
.tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.tag.kingfisher { color: #7fd6e8; border-color: #2c5a66; }
.tag.pearl { color: #e8e0f5; border-color: #5a5066; }
.tag.metal, .tag.champleve { color: var(--gold); border-color: #6a5626; }
`;
