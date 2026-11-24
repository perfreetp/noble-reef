import { sky, setSky, exportState, importState } from './state.js';
import { formatDay, formatTime, gmstRadians, stateToDate, R2D } from './astro.js';

const LAYER_NAMES = {
  stars: '星空',
  constellations: '星座',
  horizon: '地平线',
  milkyway: '银河',
};

export default function ControlPanel(props) {
  let fileInput;

  const lstHours = () => {
    const r = gmstRadians(stateToDate(sky.date, sky.time)) * R2D / 15;
    return formatTime(r % 24);
  };

  function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const err = importState(text);
      if (err) alert(`导入失败:${err}`);
    });
    e.target.value = '';
  }

  return (
    <aside class="panel">
      <h1>球幕天象投影</h1>

      <section>
        <h2>图层</h2>
        <div class="row wrap">
          {Object.entries(LAYER_NAMES).map(([key, name]) => (
            <label class="check">
              <input
                type="checkbox"
                checked={sky.layers[key]}
                onChange={(e) => setSky('layers', key, e.target.checked)}
              />
              {name}
            </label>
          ))}
        </div>
        <div class="row">
          <span class="lbl">银河强度</span>
          <div class="seg">
            {['弱', '标准', '强'].map((t, i) => (
              <button
                classList={{ on: sky.milkyWay === i }}
                onClick={() => setSky('milkyWay', i)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2>投影方式</h2>
        <div class="seg">
          <button
            classList={{ on: sky.projection === 'spherical' }}
            onClick={() => setSky('projection', 'spherical')}
          >
            球面投影
          </button>
          <button
            classList={{ on: sky.projection === 'equirect' }}
            onClick={() => setSky('projection', 'equirect')}
          >
            等距柱状
          </button>
        </div>
      </section>

      <section>
        <h2>观测纬度</h2>
        <input
          type="range"
          min="-90"
          max="90"
          step="0.5"
          value={sky.latitude}
          onInput={(e) => setSky('latitude', parseFloat(e.target.value))}
        />
        <div class="val">{sky.latitude.toFixed(1)}°</div>
      </section>

      <section>
        <h2>时间</h2>
        <label class="lbl">日期 — {formatDay(sky.date)}</label>
        <input
          type="range"
          min="1"
          max="365"
          step="1"
          value={sky.date}
          onInput={(e) => setSky('date', parseInt(e.target.value))}
        />
        <label class="lbl">时刻 — {formatTime(sky.time)} UTC</label>
        <input
          type="range"
          min="0"
          max="24"
          step="0.1"
          value={sky.time}
          onInput={(e) => setSky('time', parseFloat(e.target.value))}
        />
        <div class="val">恒星时 {lstHours()}</div>
      </section>

      <section>
        <h2>分享</h2>
        <div class="row">
          <button onClick={exportState}>导出 JSON</button>
          <button onClick={() => fileInput.click()}>导入 JSON</button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            style="display:none"
            onChange={onImportFile}
          />
        </div>
      </section>

      <footer>
        <span>{props.fps} FPS</span>
        <span>{props.starCount} 颗恒星</span>
      </footer>
    </aside>
  );
}
