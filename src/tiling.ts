/// <reference path="common.ts" />
/// <reference path="mutter_window.ts" />

module Tiling {
	// external symbols (may or may not exist in a given env)
	// GJS:
	declare var log:Void_Varargs, imports: any;

	// nodejs:
	declare var exports:any, require: any;

	export interface Window {
		// implemented by mutter_window
		id():number
		tile_preference: any
		is_active():boolean
		activate():void
		is_minimized():boolean
		minimize():void
		unminimize():void
		maximize():void
		activate_before_redraw(reason:string):void
		move_to_workspace(new_index):void
		move_resize(x:number, y:number, w:number, h:number):void
		set_tile_preference(new_pref:boolean):void
		get_title():string
		width():number
		height():number
		xpos():number
		ypos():number
	}

	export interface Bounds {
		update(newMonitor?:any):void
	}

	var Axis = {
		other: function(axis) {
			if (axis === 'y') {
				return 'x';
			} else {
				return 'y';
			}
		}
	};

	var j = function(s) {
		return JSON.stringify(s);
	};

	var HALF = 0.5;

	var STOP = '_stop_iter';

	var ArrayUtil = {
		divide_after: function(num, items) {
			return [items.slice(0, num), items.slice(num)];
		},

		moveItem: function(array, start, end) {
			var removed;
			removed = array.splice(start, 1)[0];
			array.splice(end, 0, removed);
			return array;
		}
	};

	var contains = function(arr, item) {
		return arr.indexOf(item) !== -1;
	};

	export var get_mouse_position = function():Point2d {
		throw "override get_mouse_position()";
	};

	class Tile {
		static copy_rect(rect:Rect) : Rect {
			return {
				pos: {
					x: rect.pos.x,
					y: rect.pos.y
				},
				size: {
					x: rect.size.x,
					y: rect.size.y
				}
			};
		}

		static split_rect(rect:Rect, axis, ratio, padding) {
			var new_rect, new_size_a, new_size_b;
			padding || (padding = 0);
			// log("#split_rect: splitting rect of " + j(rect) + " along the " + axis + " axis with ratio " + ratio)
			if (ratio > 1 || ratio < 0) {
				throw "invalid ratio: " + ratio + " (must be between 0 and 1)";
			}
			new_size_a = Math.round(rect.size[axis] * ratio);
			new_size_b = rect.size[axis] - new_size_a;
			padding = Math.round(Math.min(new_size_a / 2, new_size_b / 2, padding));
			// log("effective padding is " + padding)
			new_rect = Tile.copy_rect(rect);
			rect = Tile.copy_rect(rect);
			rect.size[axis] = new_size_a - padding;
			new_rect.size[axis] = new_size_b - padding;
			new_rect.pos[axis] += new_size_a + padding;

			// log("rect copy: " + j(rect))
			// log("new_rect: " + j(new_rect))
			return [rect, new_rect];
		}

		static add_diff_to_rect(rect, diff) {
			return {
				pos: Tile.point_add(rect.pos, diff.pos),
				size: Tile.point_add(rect.size, diff.size)
			};
		}

		static ensure_rect_exists(rect) {
			rect.size.x = Math.max(1, rect.size.x);
			rect.size.y = Math.max(1, rect.size.y);
			return rect;
		}

		static zero_rect(rect) {
			return rect.pos.x === 0 && rect.pos.y === 0 && rect.size.x === 0 && rect.size.y === 0;
		}

		static shrink(rect, border_px) {
			return {
				pos: {
					x: rect.pos.x + border_px,
					y: rect.pos.y + border_px
				},
				size: {
					x: Math.max(0, rect.size.x - (2 * border_px)),
					y: Math.max(0, rect.size.y - (2 * border_px))
				}
			};
		}

		static minmax(a:number, b:number):number[] {
			return [Math.min(a, b), Math.max(a, b)];
		}

		static midpoint(a:number, b:number):number {
			var max, min, _ref;
			_ref = this.minmax(a, b), min = _ref[0], max = _ref[1];
			return Math.round(min + ((max - min) / 2));
		}

		static within(val:number, a:number, b:number):boolean {
			var mm = this.minmax(a, b);
			var min = mm[0];
			var max = mm[1];
			// log("val #{val} within #{min},#{max}? #{val > min && val < max}")
			return val > min && val < max;
		}

		static move_rect_within(original_rect:Rect, bounds:Rect):Rect {
			// log("moving #{j original_rect} to be within #{j bounds}")
			var extent, max, min, rect;
			min = Math.min;
			max = Math.max;
			rect = Tile.copy_rect(original_rect);
			rect.size.x = min(rect.size.x, bounds.size.x);
			rect.size.y = min(rect.size.y, bounds.size.y);
			rect.pos.x = max(rect.pos.x, bounds.pos.x);
			rect.pos.y = max(rect.pos.y, bounds.pos.y);
			extent = function(rect, axis) {
				return rect.pos[axis] + rect.size[axis];
			};
			rect.pos.x -= max(0, extent(rect, 'x') - extent(bounds, 'x'));
			rect.pos.y -= max(0, extent(rect, 'y') - extent(bounds, 'y'));
			return {
				pos: this.point_diff(original_rect.pos, rect.pos),
				size: this.point_diff(original_rect.size, rect.size)
			};
		}
		
		static point_diff(a:Point2d, b:Point2d):Point2d {
			return {
				x: b.x - a.x,
				y: b.y - a.y
			};
		}
		
		static point_add(a:Point2d, b:Point2d):Point2d {
			return {
				x: a.x + b.x,
				y: a.y + b.y
			};
		}
		
		static rect_center(rect:Rect):Point2d {
			return {
				x: this.midpoint(rect.pos.x, rect.pos.x + rect.size.x),
				y: this.midpoint(rect.pos.y, rect.pos.y + rect.size.y)
			};
		}
		
		static point_is_within(point, rect) {
			return this.within(point.x, rect.pos.x, rect.pos.x + rect.size.x) && this.within(point.y, rect.pos.y, rect.pos.y + rect.size.y);
		}
		
		static joinRects(a:Rect, b:Rect):Rect {
			var pos, size, sx, sy;
			pos = {
				x: Math.min(a.pos.x, b.pos.x),
				y: Math.min(a.pos.y, b.pos.y)
			};
			sx = Math.max((a.pos.x + a.size.x) - pos.x, (b.pos.x + b.size.x) - pos.x);
			sy = Math.max((a.pos.y + a.size.y) - pos.y, (b.pos.y + b.size.y) - pos.y);
			size = {
				x: sx,
				y: sy
			};
			return {
				pos: pos,
				size: size
			};
		}
	}

	export interface HasId {
		id(): number
	}


	export class TileCollection {
		items = [];
		log = Log.getLogger("shellshape.tiling.TileCollection");

		constructor() {
			// provide ready-bound versions of any functions we need to use for filters:
			this.is_visible_and_untiled = Lang.bind(this, this._is_visible_and_untiled);
			this.is_tiled = Lang.bind(this, this._is_tiled);
		}

		is_visible = <FreeFunction>function(item: TiledWindow) {
			return !item.is_minimized();
		}

		is_minimized = <FreeFunction>function(item: TiledWindow) {
			return item.is_minimized();
		}

		is_visible_and_untiled: FreeFunction
		private _is_visible_and_untiled(item: TiledWindow) {
			return (!this.is_tiled(item)) && this.is_visible(item);
		}

		is_tiled: FreeFunction
		private _is_tiled(item: TiledWindow) {
			return item.managed && this.is_visible(item);
		}

		is_active = <FreeFunction>function(item: TiledWindow) {
			return item.is_active();
		}

		sort_order(item: TiledWindow) {
			if (this.is_tiled(item)) {
				return 0;
			} else if (this.is_visible(item)) {
				return 1;
			} else {
				return 2;
			}
		}

		sorted_with_indexes() {
			var index, items_and_indexes, sorted, ts, _i, _ref,
				_this = this;
			items_and_indexes = [];
			ts = function() {
				return "" + this.item + "@" + this.index;
			};
			for (index = _i = 0, _ref = this.items.length; 0 <= _ref ? _i < _ref : _i > _ref; index = 0 <= _ref ? ++_i : --_i) {
				items_and_indexes.push({
					item: this.items[index],
					index: index,
					toString: ts
				});
			}
			// this.log.debug("\nSORTING: #{j items_and_indexes}")
			sorted = items_and_indexes.slice().sort(function(a, b) {
				var ordera, orderb;
				ordera = _this.sort_order(a.item);
				orderb = _this.sort_order(b.item);
				if (ordera === orderb) {
					return a.index - b.index;
				} else {
					// ensure a stable sort by using index position for equivalent windows
					return ordera - orderb;
				}
			});
			// this.log.debug("sorted: #{items_and_indexes}\n    to: #{sorted}")
			return sorted;
		}

		private _wrap_index(idx, length) {
			while (idx < 0) {
				idx += length;
			}
			while (idx >= length) {
				idx -= length;
			}
			return idx;
		}

		filter(f:FreeFunction, items:Object[]) {
			var item, _i, _len, _results;
			var rv = [];
			for (_i = 0, _len = items.length; _i < _len; _i++) {
				item = items[_i];
				if (f(item)) {
					rv.push(item);
				}
			}
			return rv;
		}

		select_cycle(diff) {
			var cycled, filtered,
				_this = this;
			cycled = this._with_active_and_neighbor_when_filtered(this.is_visible, diff, <Anon>function(active, neighbor) {
				neighbor.item.activate();
			});
			if (!cycled) {
				// no active window - just select the first visible window if there is one
				filtered = this.filter(this.is_visible, this.items);
				if (filtered.length > 0) {
					filtered[0].activate();
				}
			}
		}

		sorted_view(filter:FreeFunction) {
			var f,
				_this = this;
			f = function(obj) {
				return filter(obj.item);
			};
			return this.filter(f, this.sorted_with_indexes());
		}

		private _with_active_and_neighbor_when_filtered(filter:FreeFunction, diff, cb:FreeFunction) {
			var filtered, filtered_active_idx, new_idx,
				_this = this;
			filtered = this.sorted_view(filter);
			filtered_active_idx = this._index_where(filtered, function(obj) {
				return _this.is_active(obj.item);
			});
			if (filtered_active_idx === null) {
				return false;
			}
			new_idx = this._wrap_index(filtered_active_idx + diff, filtered.length);
			cb(filtered[filtered_active_idx], filtered[new_idx]);
			return true;
		}

		most_recently_minimized = function(f:FreeFunction) {
			var filtered, sorted;
			filtered = this.filter(this.is_minimized, this.items);
			if (filtered.length > 0) {
				sorted = filtered.sort(function(a, b) {
					return b.minimized_order - a.minimized_order;
				});
				f(sorted[0]);
			}
		}

		cycle(diff) {
			// only one of these will have any effect, as the active tile is either tiled or untiled
			var done = this._with_active_and_neighbor_when_filtered(this.is_tiled, diff, Lang.bind(this, function(active, neighbor) {
				this.swap_at(active.index, neighbor.index);
			}));
			if (!done) {
				this._with_active_and_neighbor_when_filtered(this.is_visible_and_untiled, diff, Lang.bind(this, function(active, neighbor) {
					this.swap_at(active.index, neighbor.index);
				}));
			}
		}

		_index_where(elems, cond) {
			var i, _i, _ref;
			for (i = _i = 0, _ref = elems.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
				if (cond(elems[i])) {
					return i;
				}
			}
			return null;
		}

		_wrap_index_until(initial, offset, length, condition) {
			var index;
			index = initial;
			while (true) {
				index = this._wrap_index(index + offset, length);
				if (index === initial) {
					// break cycle in single-element list
					return initial;
				} else if (condition(index)) {
					return index;
				}
			}
		}

		swap_at(idx1, idx2) {
			// @log.debug("swapping items at index #{idx1} and #{idx2}")
			var _orig;
			_orig = this.items[idx2];
			this.items[idx2] = this.items[idx1];
			return this.items[idx1] = _orig;
		}

		contains(item:HasId) {
			return this.indexOf(item) !== -1;
		}

		indexOf(item:HasId) {
			var id, idx,
				_this = this;
			id = item.id();
			idx = -1;
			this.each(<FreeFunction>function(tile, _idx) {
				if (tile.id() === id) {
					_this.log.debug("found id " + id);
					idx = _idx;
					return STOP;
				}
				return null;
			});
			return idx;
		}

		push(item):void {
			if (this.contains(item)) {
				return;
			}
			this.items.push(item);
		}

		each(f:FreeFunction):boolean {
			var i, ret, _i, _ref;
			for (i = _i = 0, _ref = this.items.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
				ret = f(this.items[i], i);
				if (ret === STOP) {
					return true;
				}
			}
			return false;
		}

		each_tiled(f:FreeFunction) {
			this._filtered_each(this.is_tiled, f);
		}

		_filtered_each(filter:FreeFunction, f:FreeFunction) {
			this.each(<FreeFunction>function(tile, idx) {
				if (filter(tile)) {
					f(tile, idx);
				}
			});
		}

		active(f:FreeFunction) {
			this.each(Lang.bind(this, function(item, idx) {
				if (this.is_active(item)) {
					f(item, idx);
					return STOP;
				}
				return null;
			}));
		}

		for_layout() {
			// log.debug("tiles = #{@items}, filtered = #{@filter(@is_tiled, @items)}")
			return this.filter(this.is_tiled, this.items);
		}

		remove_at(idx) {
			return this.items.splice(idx, 1);
		}

		insert_at(idx, item) {
			return this.items.splice(idx, 0, item);
		}

		main(f:FreeFunction) {
			this.each(Lang.bind(this, function(tile, idx) {
				if (this.is_tiled(tile)) {
					f(tile, idx);
					return STOP;
				}
				return null;
			}));
		}
	}

	export class BaseSplit {
		log = Log.getLogger("shellshape.tiling.BaseSplit");
		ratio = HALF;
		axis: string;
		last_size: number;

		constructor(axis) {
			this.axis = axis;
		}
	
		adjust_ratio(diff:number):void {
			this.ratio = Math.min(1, Math.max(0, this.ratio + diff));
		}
	
		save_last_rect(rect:Rect):void {
			// log.debug("last_size changed from #{@last_size} -> #{rect.size[@axis]}")
			this.last_size = rect.size[this.axis];
		}
	
		maintain_split_position_with_rect_difference(diff:number):void {
			var unwanted_addition;
			unwanted_addition = this.ratio * diff;
			this.last_size += diff;
			this.log.debug("adjusting by " + (-unwanted_addition) + " to accommodate for rect size change from " + (this.last_size - diff) + " to " + this.last_size);
			this.adjust_ratio_px(-unwanted_addition);
		}
	
		adjust_ratio_px(diff:number) {
			var current_px, new_px, new_ratio;
			this.log.debug("adjusting ratio " + this.ratio + " by " + diff + " px");
			if (diff === 0) {
				return;
			}
			current_px = this.ratio * this.last_size;
			this.log.debug("current ratio makes for " + current_px + " px (assuming last size of " + this.last_size);
			new_px = current_px + diff;
			this.log.debug("but we want " + new_px);
			new_ratio = new_px / this.last_size;
			if (!Tile.within(new_ratio, 0, 1)) {
				throw "failed ratio: " + new_ratio;
			}
			this.log.debug("which makes a new ratio of " + new_ratio);
			this.ratio = new_ratio;
		}
	
	}

	
	export class Split extends BaseSplit {
		layout_one(rect, windows, padding) {
			var first_window, remaining, window_rect, _ref;
			this.save_last_rect(rect);
			first_window = windows.shift();
			if (windows.length === 0) {
				first_window.set_rect(rect);
				return [{}, []];
			}
			_ref = Tile.split_rect(rect, this.axis, this.ratio, padding), window_rect = _ref[0], remaining = _ref[1];
			first_window.set_rect(window_rect);
			return [remaining, windows];
		}
	
		toString() {
			return "Split with ratio " + this.ratio;
		}
	}

	export interface MinorSplitState {
		left: Split[]
		right: Split[]
	}

	export interface SplitState {
		main: MultiSplit
		minor: MinorSplitState
	}

	export interface SplitStates {
		x: SplitState
		y: SplitState
	}
	
	export class LayoutState {
		// shared state for every layout type. Includes distinct @splits
		// objects for both directions
		tiles: TileCollection
		splits: SplitStates
		bounds: Bounds

		constructor(bounds:Bounds, tiles?:TileCollection) {
			this.bounds = assert(bounds);
			this.tiles = tiles || new TileCollection();
			this.splits = {
				'x': {
					main: new MultiSplit('x', 1),
					minor: {
						left: [],
						right: []
					}
				},
				'y': {
					main: new MultiSplit('y', 1),
					minor: {
						left: [],
						right: []
					}
				}
			};
		}
	
		empty_copy() {
			return new LayoutState(this.bounds);
		}
	}
	
	export class MultiSplit extends BaseSplit {
		// a splitter that contains multiple windows on either side,
		// which is split along @axis (where 'x' is a split
		// that contains windows to the left and right)
		primary_windows: number
		log = Log.getLogger("shellshape.tiling.MultiSplit")

		constructor(axis:string, primary_windows: number) {
			super(axis);
			this.primary_windows = primary_windows;
		}
	
		split(bounds, windows, padding):any[][] {
			var left_rect, left_windows, right_rect, right_windows, _ref, _ref1, _ref2;
			this.save_last_rect(bounds);
			// log.debug("mainsplit: dividing #{windows.length} after #{@primary_windows} for bounds #{j bounds}")
			_ref = this.partition_windows(windows), left_windows = _ref[0], right_windows = _ref[1];
			if (left_windows.length > 0 && right_windows.length > 0) {
				_ref1 = Tile.split_rect(bounds, this.axis, this.ratio, padding), left_rect = _ref1[0], right_rect = _ref1[1];
			} else {
				// only one side wil actually be laid out...
				_ref2 = [bounds, bounds], left_rect = _ref2[0], right_rect = _ref2[1];
			}
			return [[left_rect, left_windows], [right_rect, right_windows]];
		}
	
		partition_windows(windows) {
			return ArrayUtil.divide_after(this.primary_windows, windows);
		}
	
		in_primary_partition(idx) {
			// @log.debug("on left? #{idx}, #{@primary_windows} == #{idx < @primary_windows}")
			return idx < this.primary_windows;
		}
	}
	
	export class BaseLayout {
		padding = 0;
		state: LayoutState
		tiles: TileCollection
		log: Logger
	
		constructor(name, state:LayoutState) {
			this.log = Log.getLogger("shellshape.tiling." + name);
			this.state = assert(state);
			this.tiles = state.tiles;
		}
	
		toString() {
			return "[object BaseLayout]";
		}

		layout(accommodate_window?: TiledWindow):void {
			throw new Error("To be overridden");
		}
	
		each(func:FreeFunction) {
			this.tiles.each(func);
		}
	
		contains(win:HasId) {
			return this.tiles.contains(win);
		}
	
		tile_for(win:Window, func:FreeFunction):boolean {
			var _this = this;
			if (!win) {
				return false;
			}
			return this.tiles.each(<Anon>function(tile, idx) {
				if (tile.window === win) {
					func(tile, idx);
					return STOP;
				}
				return null;
			});
		}
	
		managed_tile_for(win:Window, func:FreeFunction) {
			// like @tile_for, but ignore floating windows
			return this.tile_for(win, Lang.bind(this, function(tile, idx) {
				if (this.tiles.is_tiled(tile)) {
					func(tile, idx);
				}
			}));
		}
	
		tile(win:Window) {
			this.tile_for(win, Lang.bind(this, function(tile) {
				tile.tile();
				this.layout();
			}));
		}
	
		select_cycle(offset) {
			this.tiles.select_cycle(offset);
		}
	
		add(win:Window, active_win:Window) {
			var found, tile;
			if (this.contains(win)) {
				return false;
			}
			tile = new TiledWindow(win, this.state);
			found = this.tile_for(active_win, Lang.bind(this, function(active_tile, active_idx) {
				this.tiles.insert_at(active_idx + 1, tile);
				this.log.debug("spliced " + tile + " into tiles at idx " + (active_idx + 1));
			}));
			if (!found) {
				// no active tile, just add the new window at the end
				this.tiles.push(tile);
			}
			return true;
		}
	
		active_tile(fn:FreeFunction) {
			return this.tiles.active(fn);
		}
	
		cycle(diff) {
			this.tiles.cycle(diff);
			return this.layout();
		}
	
		minimize_window() {
			return this.active_tile(<Anon>function(tile, idx) {
				return tile.minimize();
			});
		}
	
		unminimize_last_window() {
			return this.tiles.most_recently_minimized(<Anon>function(win) {
				// TODO: this is a little odd...
				//       we do a relayout() as a result of the unminimize, and this
				//       is the only way to make sure we don't activate the previously
				//       active window.
				return TiledWindow.with_active_window(win, <Anon>function() { win.unminimize();});
			});
		}
	
		untile(win:Window) {
			this.tile_for(win, Lang.bind(this, function(tile) {
				tile.release();
				this.layout();
			}));
		}
	
		on_window_killed(win:Window):boolean {
			return this.tile_for(win, Lang.bind(this, function(tile, idx) {
				this.tiles.remove_at(idx);
				this.layout();
			}));
		}
	
		toggle_maximize() {
			var active;
			active = null;
			this.active_tile(<Anon>function(tile, idx) {
				active = tile;
			});
			if (active === null) {
				this.log.debug("active == null");
			}
			if (active === null) {
				return;
			}
			this.each(Lang.bind(this, function(tile) {
				if (tile === active) {
					this.log.debug("toggling maximize for " + tile);
					tile.toggle_maximize();
				} else {
					tile.unmaximize();
				}
			}));
		}
	
		on_window_moved(win:Window) {
			return this.on_window_resized(win);
		}
	
		on_window_resized(win:Window) {
			var found;
			found = this.tile_for(win, Lang.bind(this, function(tile, idx) {
				tile.update_original_rect();
				this.layout();
			}));
			if (!found) {
				this.log.warn("couldn't find tile for window: " + win);
			}
		}
	
		// all the actions that are specific to an actual tiling layout are NOOP'd here,
		// so the keyboard handlers don't have to worry whether it's a valid thing to call
		
		on_split_resize_start(win:Window) {
			return null;
		}
	
		adjust_splits_to_fit(win:Window) {
			return null;
		}
	
		add_main_window_count(i) {
			return null;
		}
	
		adjust_main_window_area(diff) {
			return null;
		}
	
		adjust_current_window_size(diff) {
			return null;
		}
	
		scale_current_window(amount:number, axis?:string) {
			return null;
		}
	
		adjust_split_for_tile(opts:{tile: TiledWindow; diff_ratio: number; axis: string }) {
			return null;
		}
	
		activate_main_window() {
			return null;
		}
	
		swap_active_with_main() {
			return null;
		}
	}

	export class FloatingLayout extends BaseLayout {
		constructor(state) {
			super('FloatingLayout', state)
		}
	
		toString() {
			return "[object FloatingLayout]";
		}
	
		layout(accommodate_window):void {
			this.each(Lang.bind(this, function(tile) {
				this.log.debug("resetting window state...");
				tile.resume_original_state();
				return tile.layout();
			}));
			// now don't bother laying out anything again!
			this.layout = function(accommodate_window) { };
		}
	}
	
	export class FullScreenLayout extends BaseLayout {
		constructor(state) {
			super('FullScreenLayout', state);
		}
	
		toString() {
			return "[object FullScreenLayout]";
		}
	
		layout(accommodate_window) {
			this.each(<Anon>function(tile) {
				return tile.window.maximize();
			});
			return this.layout;
		}
	}
	
	export class BaseTiledLayout extends BaseLayout {
		bounds: Bounds
		main_split: MultiSplit
		splits: MinorSplitState
		main_axis: string
		// private split_resize_start_rect: Rect = null

		constructor(name, axis, state:LayoutState) {
			super(name, state);
			// TODO: remove need for these instance vars
			this.main_axis = axis;
			this.bounds = state.bounds;
			this.main_split = state.splits[this.main_axis].main;
			this.splits = state.splits[this.main_axis].minor;
		}
	
		toString() {
			return "[object BaseTiledLayout]";
		}
	
		_each_tiled(func:FreeFunction) {
			return this.tiles.each_tiled(func);
		}
	
		layout(accommodate_window?:TiledWindow) {
			this.bounds.update();
			var padding = this.padding;
			var layout_windows = this.tiles.for_layout();
			this.log.debug("laying out " + layout_windows.length + " windows");
			if (accommodate_window != null) {
				this._change_main_ratio_to_accommodate(accommodate_window, this.main_split);
			}

			var _ref = this.main_split.split(this.bounds, layout_windows, padding);
			var left = _ref[0]
			var right = _ref[1];

			// @log.debug("split screen into rect #{j left[0]} | #{j right[0]}")
			this._layout_side.apply(this, left.concat( [this.splits.left,  accommodate_window, padding]));
			this._layout_side.apply(this, right.concat([this.splits.right, accommodate_window, padding]));
		}
	
		_layout_side(rect, windows, splits, accommodate_window, padding) {
			var accommodate_idx, axis, bottom_split, extend_to, other_axis, previous_split, split, top_splits, window, zip, _i, _len, _ref, _ref1, _ref2, _results;
			axis = Axis.other(this.main_axis);
			extend_to = function(size, array, generator) {
				var _results;
				_results = [];
				while (array.length < size) {
					_results.push(array.push(generator()));
				}
				return _results;
			};
			zip = function(a, b) {
				var i;
				return (function() {
					var _i, _ref, _results;
					_results = [];
					for (i = _i = 0, _ref = Math.min(a.length, b.length); 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
						_results.push([a[i], b[i]]);
					}
					return _results;
				})();
			};
			extend_to(windows.length, splits, function() {
				return new Split(axis);
			});
			// @log.debug("laying out side with rect #{j rect}, windows #{windows.length} and splits #{splits.length}")

			if (accommodate_window != null) {
				accommodate_idx = windows.indexOf(accommodate_window);
				if (accommodate_idx !== -1) {
					top_splits = splits.slice(0, accommodate_idx);
					bottom_split = splits[accommodate_idx];
					if (accommodate_idx === windows.length - 1) {
						bottom_split = void 0;
					}
					other_axis = Axis.other(this.main_axis);
					this._change_minor_ratios_to_accommodate(accommodate_window, top_splits, bottom_split);
				}
			}
			previous_split = null;
			_ref = zip(windows, splits);
			_results = [];
			for (_i = 0, _len = _ref.length; _i < _len; _i++) {
				_ref1 = _ref[_i], window = _ref1[0], split = _ref1[1];
				window.top_split = previous_split;
				_ref2 = split.layout_one(rect, windows, padding), rect = _ref2[0], windows = _ref2[1];
				window.ensure_within(this.bounds);
				window.bottom_split = windows.length > 0 ? split : null;
				_results.push(previous_split = split);
			}
			return _results;
		}
	
		add_main_window_count(i) {
			this.main_split.primary_windows += i;
			return this.layout();
		}
	
		adjust_main_window_area(diff) {
			this.main_split.adjust_ratio(diff);
			return this.layout();
		}
	
		adjust_current_window_size(diff) {
			return this.active_tile(Lang.bind(this, function(tile) {
				this.adjust_split_for_tile({
					tile: tile,
					diff_ratio: diff,
					axis: Axis.other(this.main_axis)
				});
				this.layout();
			}));
		}
	
		scale_current_window(amount, axis) {
			var bounds = this.bounds;
			this.active_tile(<Anon>function(tile) {
				tile.scale_by(amount, axis);
				tile.center_window();
				tile.ensure_within(bounds);
				tile.layout();
			});
		}
	
		adjust_split_for_tile(opts) {
			var adjust, axis, diff_px, diff_ratio, tile;
			axis = opts.axis, diff_px = opts.diff_px, diff_ratio = opts.diff_ratio, tile = opts.tile;
			adjust = function(split, inverted) {
				if (diff_px != null) {
					split.adjust_ratio_px(inverted ? -diff_px : diff_px);
				} else {
					split.adjust_ratio(inverted ? -diff_ratio : diff_ratio);
				}
			};
			if (axis === this.main_axis) {
				adjust(this.main_split, !this.main_split.in_primary_partition(this.tiles.indexOf(tile)));
			} else {
				if (tile.bottom_split != null) {
					adjust(tile.bottom_split, false);
				} else if (tile.top_split != null) {
					adjust(tile.top_split, true);
				}
			}
		}
	
		activate_main_window() {
			var _this = this;
			this.tiles.main(<Anon>function(win) {
				win.activate();
			});
		}
	
		swap_active_with_main() {
			var _this = this;
			this.tiles.active(<Anon>function(tile, idx) {
				_this.tiles.main(<Anon>function(main_tile, main_idx) {
					_this.tiles.swap_at(idx, main_idx);
					_this.layout();
				});
			});
		}
	
		on_window_moved(win:Window) {
			this.tile_for(win, Lang.bind(this, function(tile, idx) {
				var moved;
				moved = false;
				if (tile.managed) {
					moved = this._swap_moved_tile_if_necessary(tile, idx);
				}
				if (!moved) {
					tile.update_offset();
				}
				this.layout();
			}));
		}
	
		// on_split_resize_start(win) {
		//	 TODO: this is never called in mutter
		//	 this.split_resize_start_rect = Tile.copy_rect(this.tiles[this.indexOf(win)].window_rect());
		//	 return this.log.debug("starting resize of split.. " + (j(this.split_resize_start_rect)));
		// }
	
		on_window_resized(win) {
			this.managed_tile_for(win, Lang.bind(this, function(tile, idx) {
				var diff;
				// TODO: uncomment when on_split_resize_start is used
				// if (this.split_resize_start_rect != null) {
				//	 diff = Tile.point_diff(this.split_resize_start_rect.size, tile.window_rect().size);
				//	 this.log.debug("split resized! diff = " + (j(diff)));
				//	 if (diff.x !== 0) {
				//		 this.adjust_split_for_tile({
				//			 tile: tile,
				//			 diff_px: diff.x,
				//			 axis: 'x'
				//		 });
				//	 }
				//	 if (diff.y !== 0) {
				//		 this.adjust_split_for_tile({
				//			 tile: tile,
				//			 diff_px: diff.y,
				//			 axis: 'y'
				//		 });
				//	 }
				//	 this.split_resize_start_rect = null;
				// } else {
					tile.update_offset();
				// }
				this.layout();
				return true;
			}));
		}
	
		adjust_splits_to_fit(win) {
			this.managed_tile_for(win, Lang.bind(this, function(tile, idx) {
				if (!this.tiles.is_tiled(tile)) return;
				this.layout(tile);
			}));
		}
	
		private _change_main_ratio_to_accommodate(tile, split) {
			var left, right, _ref;
			_ref = split.partition_windows(this.tiles.for_layout()), left = _ref[0], right = _ref[1];
			if (contains(left, tile)) {
				this.log.debug("LHS adjustment for size: " + (j(tile.offset.size)) + " and pos " + (j(tile.offset.pos)));
				split.adjust_ratio_px(tile.offset.size[this.main_axis] + tile.offset.pos[this.main_axis]);
				tile.offset.size[this.main_axis] = -tile.offset.pos[this.main_axis];
			} else if (contains(right, tile)) {
				this.log.debug("RHS adjustment for size: " + (j(tile.offset.size)) + " and pos " + (j(tile.offset.pos)));
				split.adjust_ratio_px(tile.offset.pos[this.main_axis]);
				tile.offset.size[this.main_axis] += tile.offset.pos[this.main_axis];
				tile.offset.pos[this.main_axis] = 0;
			}
			this.log.debug("After main_split accommodation, tile offset = " + (j(tile.offset)));
		}
	
		_change_minor_ratios_to_accommodate(tile, above_splits, below_split) {
			var axis, bottom_offset, diff_px, diff_pxes, i, offset, proportion, size_taken, split, split_size, split_sizes, top_offset, total_size_above, _i, _j, _k, _len, _ref, _ref1;
			offset = tile.offset;
			axis = Axis.other(this.main_axis);
			top_offset = offset.pos[axis];
			bottom_offset = offset.size[axis];
			if (above_splits.length > 0) {
				// TODO: this algorithm seems needlessly involved. Figure out if there's a cleaner
				//       way of doing it
				this.log.debug("ABOVE adjustment for offset: " + (j(offset)) + ", " + top_offset + " diff required across " + above_splits.length);
				diff_pxes = [];
				split_sizes = [];
				total_size_above = 0;
				for (_i = 0, _len = above_splits.length; _i < _len; _i++) {
					split = above_splits[_i];
					split_size = split.last_size * split.ratio;
					split_sizes.push(split_size);
					total_size_above += split_size;
				}
				for (i = _j = 0, _ref = above_splits.length; 0 <= _ref ? _j < _ref : _j > _ref; i = 0 <= _ref ? ++_j : --_j) {
					proportion = split_sizes[i] / total_size_above;
					diff_pxes.push(proportion * top_offset);
				}
				this.log.debug("diff pxes for above splits are: " + (j(diff_pxes)));
				size_taken = 0;
				for (i = _k = 0, _ref1 = above_splits.length; 0 <= _ref1 ? _k < _ref1 : _k > _ref1; i = 0 <= _ref1 ? ++_k : --_k) {
					split = above_splits[i];
					diff_px = diff_pxes[i];
					split.maintain_split_position_with_rect_difference(-size_taken);
					size_taken += diff_px;
					split.adjust_ratio_px(diff_px);
				}
				tile.offset.pos[axis] = 0;
				if (below_split != null) {
					this.log.debug("MODIFYING bottom to accomodate top_px changes == " + top_offset);
					// TODO: seems a pretty hacky place to do it..
					below_split.maintain_split_position_with_rect_difference(-top_offset);
				} else {
					tile.offset.size[axis] += top_offset;
				}
			} else {
				bottom_offset += top_offset;
			}
			if (below_split != null) {
				this.log.debug("BELOW adjustment for offset: " + (j(offset)) + ", bottom_offset = " + bottom_offset);
				this.log.debug("before bottom minor adjustments, offset = " + (j(tile.offset)));
				below_split.adjust_ratio_px(bottom_offset);
				tile.offset.size[axis] -= bottom_offset;
			}
			this.log.debug("After minor adjustments, offset = " + (j(tile.offset)));
		}
	
		_swap_moved_tile_if_necessary(tile, idx) {
			var moved = false;
			if (this.tiles.is_tiled(tile)) {
				var mouse_pos = get_mouse_position();
				this._each_tiled(Lang.bind(this, function(swap_candidate, swap_idx) {
					var target_rect: Rect;
					target_rect = Tile.shrink(swap_candidate.rect, 20);
					if (swap_idx === idx) {
						return null;
					}
					if (Tile.point_is_within(mouse_pos, target_rect)) {
						this.log.debug("swapping idx " + idx + " and " + swap_idx);
						this.tiles.swap_at(idx, swap_idx);
						moved = true;
						return STOP;
					}
					return null;
				}));
			}
			return moved;
		}
	
		// private _log_state(lbl) {
		// 	var dump_win;
		// 	dump_win = function(w) {
		// 		return this.log.debug("	 - " + j(w.rect));
		// 	};
		// 	this.log.debug(" -------------- layout ------------- ");
		// 	this.log.debug(" // " + lbl);
		// 	this.log.debug(" - total windows: " + this.tiles.length);
		// 	this.log.debug("");
		// 	this.log.debug(" - main windows: " + this.mainsplit.primary_windows);
		// 	this.main_windows().map(dump_win);
		// 	this.log.debug("");
		// 	this.log.debug(" - minor windows: " + this.tiles.length - this.mainsplit.primary_windows);
		// 	this.minor_windows().map(dump_win);
		// 	return this.log.debug(" ----------------------------------- ");
		// }
	}
	
	export class VerticalTiledLayout extends BaseTiledLayout {
		constructor(state) {
			super('VerticalTiledLayout', 'x', state);
		}
	
		toString() {
			return "[object VerticalTiledLayout]";
		}
	}

	export class HorizontalTiledLayout extends BaseTiledLayout {
		constructor(state) {
			super('HorizontalTiledLayout', 'y', state);
		}
	
		toString() {
			return "[object HorizontalTiledLayout]";
		}
	}

	export interface Point2d {
		x: number
		y: number
	}

	export interface Rect {
		pos: Point2d
		size: Point2d
	}
	
	export class TiledWindow {
		log: Logger
		window: Window
		bounds: any
		maximized = false
		managed = false
		private _was_minimized = false
		minimized_order = 0
		rect: Rect
		offset: Rect
		original_rect: Rect

		private static minimized_counter = 0;
		private static active_window_override = null;

		static with_active_window(win, f:FreeFunction) {
			var _old = TiledWindow.active_window_override;
			TiledWindow.active_window_override = win;
			try {
				f();
			} finally {
				TiledWindow.active_window_override = _old;
			}
		}

		constructor(win, state:LayoutState) {
			this.log = Log.getLogger("shellshape.tiling.TiledWindow");
			this.window = win;
			this.bounds = state.bounds;
			this.maximized = false;
			this.managed = false;
			this._was_minimized = false;
			this.minimized_order = 0;
			this.rect = {
				pos: {
					x: 0,
					y: 0
				},
				size: {
					x: 0,
					y: 0
				}
			};
			this.update_original_rect();
		}

		id() {
			return this.window.id();
		}

		update_original_rect = function() {
			this.original_rect = this.window_rect();
			this.log.debug("window " + this + " remembering new rect of " + (JSON.stringify(this.original_rect)));
		}

		resume_original_state() {
			this.reset_offset();
			this.rect = Tile.copy_rect(this.original_rect);
			this.log.debug("window " + this + " resuming old rect of " + (JSON.stringify(this.rect)));
		}

		tile() {
			if (this.managed) {
				this.log.debug("resetting offset for window " + this);
				this.reset_offset();
			} else {
				this.managed = true;
				this.window.set_tile_preference(true);
				this.original_rect = this.window_rect();
			}
			this.reset_offset();
		}

		reset_offset():void {
			this.offset = {
				pos: {
					x: 0,
					y: 0
				},
				size: {
					x: 0,
					y: 0
				}
			};
		}

		toString() {
			return "<\#TiledWindow of " + this.window.toString() + ">";
		}

		update_offset() {
			var rect, win;
			rect = this.rect;
			win = this.window_rect();
			this.offset = {
				pos: Tile.point_diff(rect.pos, win.pos),
				size: Tile.point_diff(rect.size, win.size)
			};
			this.log.debug("updated tile offset to " + (j(this.offset)));
		}

		window_rect():Rect {
			return {
				pos: {
					x: this.window.xpos(),
					y: this.window.ypos()
				},
				size: {
					x: this.window.width(),
					y: this.window.height()
				}
			};
		}

		toggle_maximize() {
			if (this.maximized) {
				this.unmaximize();
			} else {
				this.maximize();
			}
		}

		is_minimized() {
			var min;
			min = this.window.is_minimized();
			if (min && !this._was_minimized) {
				// the window with the highest minimise order is the most-recently minimized
				this.minimized_order = TiledWindow.minimized_counter++;
			}
			this._was_minimized = min;
			return min;
		}

		maximize() {
			if (!this.maximized) {
				this.maximized = true;
				this.update_offset();
				this.layout();
			}
		}

		unmaximize() {
			if (this.maximized) {
				this.maximized = false;
				if (!this.managed) {
					this.log.debug("unmaximize caused layout()");
				}
				this.layout();
			}
		}

		unminimize() {
			this.window.unminimize();
		}

		minimize() {
			this.window.minimize();
		}

		private _resize(size) {
			this.rect.size = {
				x: size.x,
				y: size.y
			};
		}

		private _move(pos) {
			this.rect.pos = {
				x: pos.x,
				y: pos.y
			};
		}

		set_rect(r) {
			// log("offset rect to " + j(@offset))
			// @log.debug("tile has new rect: " + j(r))
			this._resize(r.size);
			this._move(r.pos);
			this.layout();
		}

		ensure_within(screen_rect) {
			var change_required, combined_rect;
			combined_rect = Tile.add_diff_to_rect(this.rect, this.offset);
			change_required = Tile.move_rect_within(combined_rect, screen_rect);
			if (!Tile.zero_rect(change_required)) {
				log("moving tile " + (j(change_required)) + " to keep it onscreen");
				this.offset = Tile.add_diff_to_rect(this.offset, change_required);
				this.layout();
			}
		}

		center_window() {
			var movement_required, tile_center, window_center, window_rect;
			window_rect = this.window_rect();
			tile_center = Tile.rect_center(this.rect);
			window_center = Tile.rect_center(window_rect);
			movement_required = Tile.point_diff(window_center, tile_center);
			this.offset.pos = Tile.point_add(this.offset.pos, movement_required);
		}

		layout() {
			var is_active, pos, rect, size, _ref;
			if (TiledWindow.active_window_override) {
				is_active = TiledWindow.active_window_override === this;
			} else {
				is_active = this.is_active();
			}
			rect = this.maximized_rect() || Tile.add_diff_to_rect(this.rect, this.offset);
			_ref = Tile.ensure_rect_exists(rect), pos = _ref.pos, size = _ref.size;
			this.window.move_resize(pos.x, pos.y, size.x, size.y);
			if (is_active) {
				this.window.activate_before_redraw("layout");
			}
		}

		maximized_rect():Rect {
			if (!this.maximized) {
				return null;
			}
			return Tile.shrink(this.bounds, 20);
		}

		scale_by(amount, axis) {
			var window_rect;
			window_rect = this.window_rect();
			if (axis != null) {
				this._scale_by(amount, axis, window_rect);
			} else {
				// scale in both directions
				this._scale_by(amount, 'x', window_rect);
				this._scale_by(amount, 'y', window_rect);
			}
		}

		private _scale_by(amount, axis, window_rect) {
			var current_dim, diff_px, new_dim;
			current_dim = window_rect.size[axis];
			diff_px = amount * current_dim;
			new_dim = current_dim + diff_px;
			this.offset.size[axis] += diff_px;
			this.offset.pos[axis] -= diff_px / 2;
		}

		release() {
			this.set_rect(this.original_rect);
			this.managed = false;
			this.window.set_tile_preference(false);
		}

		activate() {
			this.window.activate();
		}

		is_active() {
			return this.window.is_active();
		}
	}






	/********* Exports *******************/
	

	// hacky stuff for running in the browser, node & gjs
	if (typeof log === "undefined" || log === null) {
		if (typeof require !== "undefined" && require !== null) {
			log = require('util').log;

		} else {
			if (typeof console !== "undefined" && console !== null) {
				log = function(s) { console.log(s); };

			} else {
				log = function(s) { };

			}
		}
	}
}