const ROLES = { station: 'Station', robot: 'Robot', medicine: 'Medicine box' };
const inputClass = 'mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 disabled:opacity-50';

export default function PhoneVisionSetup({ setup, onChange, locked, markers, error }) {
  const number = (label, value, change, min = 0, step = 0.001) => <label className="block">{label}
    <input type="number" className={inputClass} value={Number.isFinite(value) ? value : ''} min={min} step={step} disabled={locked}
      onChange={(e) => change(e.target.value === '' ? NaN : Number(e.target.value))} />
  </label>;
  const patch = (changes) => onChange({ ...setup, ...changes });
  const mount = (role, key, value) => patch({ mounts: { ...setup.mounts, [role]: { ...setup.mounts[role], [key]: value } } });
  return <section className="rounded-lg border border-cyan-900 bg-slate-900 p-3">
    <h2 className="mb-2 font-bold uppercase tracking-wide text-slate-300">Phone camera setup</h2>
    <p className="mb-2 text-slate-400">Match the printed marker family and assign roles. Measure the black station square without its white margin. All distances below are metres.</p>
    <label className="mb-2 block">Marker dictionary
      <select className={inputClass} value={setup.family} disabled={locked} onChange={(e) => patch({ family: e.target.value })}>
        <option value="5x5_100">OpenCV DICT_5X5_100</option><option value="6x6_250">OpenCV DICT_6X6_250</option><option value="legacy">Original ArUco</option>
      </select>
    </label>
    <p className="mb-2 text-cyan-300">Detected IDs: {[...new Set(markers.map((m) => m.id))].sort((a, b) => a - b).join(', ') || 'none — point at a printed marker'}</p>
    <div className="mb-2 grid grid-cols-3 gap-2">
      {Object.entries(ROLES).map(([role, label]) => <div key={role}>
        {number(`${label} ID`, setup.ids[role], (id) => patch({ ids: { ...setup.ids, [role]: id } }), 0, 1)}
        {markers.some((m) => m.id === setup.ids[role]) && <span className="text-emerald-400">Visible</span>}
      </div>)}
    </div>
    {number('Station marker black-square size (m)', setup.stationSize, (stationSize) => patch({ stationSize }), 0.001)}
    <div className="my-2 grid grid-cols-2 gap-2">
      {Object.entries(ROLES).map(([role, label]) => <div key={role} className="contents">
        {number(`${label} marker height above floor`, setup.mounts[role].height, (v) => mount(role, 'height', v))}
        {number(`${label} marker forward offset`, setup.mounts[role].forward, (v) => mount(role, 'forward', v), null)}
      </div>)}
      {number('Station body depth', setup.stationDepth, (stationDepth) => patch({ stationDepth }), 0.001)}
      {number('Robot body depth', setup.robotDepth, (robotDepth) => patch({ robotDepth }), 0.001)}
    </div>
    <p className="mb-2 text-slate-500">Offsets: station marker from station centre; robot marker from axle; medicine marker from robot axle, along each object’s forward direction. Negative means behind. Set heights to 0 for a tabletop experiment on the reference plane.</p>
    <label className="mb-2 block"><input type="checkbox" disabled={locked} checked={setup.estimateFocal} onChange={(e) => patch({ estimateFocal: e.target.checked })} /> Estimate focal length from station marker</label>
    {!setup.estimateFocal && number('Calibrated focal length (source-video px)', setup.focalPx, (focalPx) => patch({ focalPx }), 1, 1)}
    <p className="mt-2 text-slate-400">For automatic focal estimation, view the station at an angle. For a straight overhead view, enter the camera’s calibrated focal length. Changing settings resets calibration. Settings lock during a test.</p>
    {error && <p role="alert" className="mt-2 text-amber-300">{error}</p>}
  </section>;
}
