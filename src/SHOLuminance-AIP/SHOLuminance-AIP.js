#engine v8

#feature-id SHOLuminance_AIP : CCD1024 > SHOLuminance-AIP
#feature-icon AIP.svg
#feature-info Combine three monochrome SII/Ha/OIII images into a full-resolution synthetic luminance. \
   Weighted mean, Lighten and Screen; linear/nonlinear source selector; live grayscale preview, display-only STF, DATA histogram, FR/EN and process instances.

/*
 * SHOLuminance-AIP 0.6.1 — Philippe Bernhard
 * PixInsight >= 1.9.4 / PJSR V8.
 * Adapted from SHORGB-AIP 0.2.26: block-based image access, preview zoom,
 * histogram and median/MAD/MTF display. Independent settings and instance keys.
 * L = (wS*SII + wH*Ha + wO*OIII)/(wS+wH+wO) by default.
 * Mean: optional weight normalization; Lighten: max(gain*source).
 * Screen: 1-product(1-opacity*source), opacities in [0,1], sources in [0,1].
 * Weights are stored independently for each combination.
 * Preview range normalization precedes direct display and STF statistics.
 * Final histogram uses the normalized preview samples before STF.
 * Source histograms show corrected inputs before weights on a shared data axis.
 * Source and optional final histogram overlays share data and count axes.
 * Optional source-foot alignment precedes gains/opacities and combination.
 * Common or independent source-foot targets; Screen uses one common range scale.
 * Separate-foot mode activates its corrections independently of common-foot mode.
 * STF is display-only. Originals are never modified. Output is one gray channel.
 * Inputs must already be registered, with the same dimensions and processing stage.
 * Weights express the user's chosen signal contributions, not measured SNR weights.
 */

CoreApplication.ensureMinimumVersion( 1, 9, 4 );
var TITLE = "SHOLuminance-AIP", VERSION = "0.6.1";
var INSTANCE_KEY = "SHOLuminance_AIP_configuration_v01";
var SETTINGS_KEY = "SHOLuminance_AIP/settings_v01";
var LANGUAGE_KEY = "SHOLuminance_AIP/language";
var SOURCE_NAMES = [ "SII", "Ha", "OIII" ];
var HIST_SOURCE_COLORS = [0xffff6b6b,0xff65e08a,0xff67b3ff], HIST_FINAL_COLOR = 0xffeeeeee;
var HIST_BINS = 16384, BLOCK_ROWS = 128;
var PREVIEW_SIZES = [ 1200, 1800, 2400 ];
var HIST_ZOOMS = [ 1, 2, 5, 10, 20 ];
var STF_TARGETS = [ 0.15, 0.25, 0.35 ];
var PRESETS = [ [1,1,1], [1,2,1], [1,3,1], [0,1,1], [1,0,0], [0,1,0], [0,0,1] ];
var SCREEN_PRESETS = [ [1,1,1], [0.5,1,0.5], [0.333,1,0.333], [0,1,1], [1,0,0], [0,1,0], [0,0,1] ];
var DEFAULTS = {
   language: "fr", ids: ["","",""], weights: [1,1,1], normalizeWeights: true,
   combination: 0, lightWeights: [1,1,1], screenWeights: [1,1,1], sourceMode: 0,
   alignHistogramFoot: false, histFloorTarget: 0.0050,
   showAdvanced: false, separateFootTargets: false, footTargets: [0.0050,0.0050,0.0050],
   useSTF: true, stfLevel: 1, previewSizeIndex: 0,
   histView: 0, histScale: 1, histZoomIndex: 0, histStart: 0
};
var P = null, CACHE = null;

function tr( french, english ) { return P != null && P.language == "en" ? english : french; }
function cloneDefaults() { return JSON.parse( JSON.stringify( DEFAULTS ) ); }

function loadSettings()
{
   P = cloneDefaults();
   try
   {
      var language = Settings.read( LANGUAGE_KEY, DataType.String );
      if ( language == "fr" || language == "en" ) P.language = language;
      var instance = (Parameters.isGlobalTarget || Parameters.isViewTarget) && Parameters.has(INSTANCE_KEY);
      var text = instance ? Parameters.getString(INSTANCE_KEY) : Settings.read(SETTINGS_KEY,DataType.String);
      if ( !text ) return;
      var o = JSON.parse(text);
      if ( o.language == "fr" || o.language == "en" ) P.language = o.language;
      if ( Array.isArray(o.ids) && o.ids.length == 3 )
         for ( var s = 0; s < 3; ++s ) if ( typeof o.ids[s] == "string" ) P.ids[s] = o.ids[s];
      if ( Array.isArray(o.weights) && o.weights.length == 3 )
         for ( var s = 0; s < 3; ++s ) P.weights[s] = clamp(safeNumber(o.weights[s],1),0,3);
      if ( typeof o.normalizeWeights == "boolean" ) P.normalizeWeights = o.normalizeWeights;
      if ( typeof o.useSTF == "boolean" ) P.useSTF = o.useSTF;
      if ( typeof o.alignHistogramFoot == "boolean" ) P.alignHistogramFoot = o.alignHistogramFoot;
      P.histFloorTarget = Math.round(clamp(safeNumber(o.histFloorTarget,P.histFloorTarget),0,0.5)*10000)/10000;
      if ( typeof o.showAdvanced == "boolean" ) P.showAdvanced = o.showAdvanced;
      if ( typeof o.separateFootTargets == "boolean" ) P.separateFootTargets = o.separateFootTargets;
      // Old icons retain common-foot mode and seed the new controls from it.
      for ( var s = 0; s < 3; ++s )
         P.footTargets[s] = Math.round(clamp(safeNumber(Array.isArray(o.footTargets) && o.footTargets.length==3 ? o.footTargets[s] : null,P.histFloorTarget),0,0.5)*10000)/10000;
      P.combination = clamp(Math.round(safeNumber(o.combination,0)),0,2);
      P.sourceMode = clamp(Math.round(safeNumber(o.sourceMode,0)),0,1);
      for ( var key of ["lightWeights","screenWeights"] )
         if ( Array.isArray(o[key]) && o[key].length == 3 )
            for ( var s = 0; s < 3; ++s ) P[key][s] = clamp(safeNumber(o[key][s],1),0,key=="screenWeights"?1:3);
      P.stfLevel = clamp(Math.round(safeNumber(o.stfLevel,1)),0,2);
      P.previewSizeIndex = clamp(Math.round(safeNumber(o.previewSizeIndex,0)),0,2);
      P.histScale = clamp(Math.round(safeNumber(o.histScale,1)),0,3);
      P.histView = clamp(Math.round(safeNumber(o.histView,0)),0,5);
      P.histZoomIndex = clamp(Math.round(safeNumber(o.histZoomIndex,0)),0,HIST_ZOOMS.length-1);
      P.histStart = clamp(safeNumber(o.histStart,0),0,1-1/HIST_ZOOMS[P.histZoomIndex]);
   }
   catch ( e ) { console.warningln(TITLE + ": " + errText(e)); }
}

function saveSettings()
{
   Settings.write(SETTINGS_KEY,DataType.String,JSON.stringify(P));
   Settings.write(LANGUAGE_KEY,DataType.String,P.language);
}
function exportInstanceParameters() { Parameters.set(INSTANCE_KEY,JSON.stringify(P)); }

function clamp( x, a, b )
{
   return x < a ? a : ( x > b ? b : x );
}

function clamp01( x )
{
   return clamp( x, 0, 1 );
}

function safeNumber( x, d )
{
   return ( typeof x == "number" && isFinite( x ) ) ? x : d;
}

function findView( id )
{
   if ( id == null || id.length == 0 )
      return null;
   var v = View.viewById( id );
   return ( v == null || v.isNull ) ? null : v;
}

function validId( base )
{
   var id = base.replace( /[^A-Za-z0-9_]/g, "_" );
   if ( /^[0-9]/.test( id ) )
      id = "_" + id;
   if ( findView( id ) == null )
      return id;
   var n = 1;
   while ( findView( id + n ) != null )
      ++n;
   return id + n;
}

function errText( e )
{
   return ( e && e.message ) ? e.message : String( e );
}

function showError( parent, msg )
{
   ( new MessageBox( "<p>" + msg + "</p>", TITLE, StdIcon.Error, StdButton.Ok ) ).execute();
}

function blockAverageView( view, channel, step, ww, wh, statistics )
{
   var image = view.image, W = image.width, H = image.height;
   var acc = new Float64Array( ww*wh );
   var minimum = Infinity, maximum = -Infinity;
   // Copy bounded blocks: no ArrayBuffer is borrowed from an image.
   for ( var y0 = 0; y0 < H; y0 += BLOCK_ROWS )
   {
      var y1 = Math.min( H, y0 + BLOCK_ROWS );
      var samples = new Float64Array( W*(y1-y0) );
      image.getSamples( samples, new Rect( 0, y0, W, y1 ), channel );
      for ( var y = y0; y < y1; ++y )
      {
         var row = (y-y0)*W, base = Math.floor(y/step)*ww;
         for ( var x = 0; x < W; ++x )
         {
            var value = samples[row+x];
            if ( !isFinite(value) )
               throw new Error( tr( "Source contenant un pixel non valide : ", "Source contains a non-finite pixel: " ) + view.id );
            acc[base+Math.floor(x/step)] += value;
            if ( value < minimum ) minimum = value;
            if ( value > maximum ) maximum = value;
         }
      }
      if ( y0 > 0 && y0 % (BLOCK_ROWS*8) == 0 ) CoreApplication.processEvents();
   }
   var out = new Float32Array( ww*wh );
   for ( var by = 0; by < wh; ++by )
      for ( var bx = 0; bx < ww; ++bx )
      {
         var area = Math.min(step,H-by*step)*Math.min(step,W-bx*step);
         var i = by*ww+bx;
         out[i] = acc[i]/area;
         if ( !isFinite(out[i]) )
            throw new Error( tr( "Valeur hors format dans la source : ", "Out-of-format sample in source: " ) + view.id );
      }
   if ( statistics ) { statistics.minimum = minimum; statistics.maximum = maximum; }
   return out;
}

function percentileFromHistogram( h, p )
{
   var total = 0;
   for ( var i = 0; i < h.length; ++i )
      total += h[i];
   if ( total <= 0 )
      return 0;
   var target = p * 0.01 * ( total - 1 );
   var acc = 0;
   for ( var i = 0; i < h.length; ++i )
   {
      acc += h[i];
      if ( acc > target )
         return i / ( h.length - 1 );
   }
   return 1;
}

function sampledPercentiles( values, fractions )
{
   var count = Math.min( 65536, values.length );
   var samples = [];
   for ( var i = 0; i < count; ++i )
   {
      var value = values[Math.floor( ( i + 0.5 )*values.length/count )];
      if ( isFinite( value ) ) samples.push( value );
   }
   if ( samples.length == 0 )
      throw new Error( tr( "Impossible d'estimer le pied : aucun pixel valide.", "Cannot estimate the histogram foot: no valid pixels." ) );
   samples.sort( function( a, b ) { return a - b; } );
   var result = [];
   for ( var k = 0; k < fractions.length; ++k )
   {
      var position = clamp( fractions[k], 0, 1 )*( samples.length - 1 );
      var index = Math.floor( position );
      result[k] = samples[index] + ( position - index )*( samples[Math.min( index + 1, samples.length - 1 )] - samples[index] );
   }
   return result;
}

// Midtones transfer function used by PixInsight-style STF displays.
function mtf( m, x )
{
   x = clamp01( x );
   if ( x <= 0 ) return 0;
   if ( x >= 1 ) return 1;
   m = clamp( m, 1e-6, 1 - 1e-6 );
   var d = ( 2*m - 1 )*x - m;
   if ( Math.abs( d ) < 1e-12 )
      return x;
   return clamp01( ( ( m - 1 )*x ) / d );
}

// Finds the MTF midtones parameter m such that mtf(m,x) = target.
function mtfParameterForTarget( target, x )
{
   target = clamp( target, 1e-4, 1 - 1e-4 );
   x = clamp( x, 1e-8, 1 - 1e-8 );
   var d = x + target - 2*x*target;
   if ( Math.abs( d ) < 1e-12 )
      return 0.5;
   return clamp( x*( 1 - target )/d, 1e-5, 1 - 1e-5 );
}

function fineHistogramOfArray( arr, bins )
{
   var h = new Uint32Array( bins );
   for ( var i = 0; i < arr.length; ++i )
   {
      var v = arr[i];
      if ( !isFinite( v ) )
         continue;
      ++h[Math.round( clamp01( v )*( bins - 1 ) )];
   }
   return h;
}

function madFromArray( arr, median, bins )
{
   var h = new Uint32Array( bins );
   for ( var i = 0; i < arr.length; ++i )
   {
      var v = arr[i];
      if ( !isFinite( v ) )
         continue;
      var d = Math.abs( clamp01( v ) - median );
      ++h[Math.round( clamp01( d )*( bins - 1 ) )];
   }
   return percentileFromHistogram( h, 50 );
}

// One black point and MTF derived from median and MAD.
function stfFromStatistics( median, mad )
{
   var sigma = 1.4826*mad;
   var c0 = clamp( median - 2.8*sigma, 0, 1 );
   if ( c0 >= median - 1e-8 ) c0 = 0;
   var x = clamp( (median-c0)/Math.max(1e-8,1-c0), 1e-8, 1-1e-8 );
   var level = clamp( Math.round( safeNumber( P.stfLevel, 1 ) ), 0, STF_TARGETS.length - 1 );
   return { c0:c0, m:mtfParameterForTarget(STF_TARGETS[level],x), median:median, mad:mad };
}

function applySTF( v, stf )
{
   return mtf(stf.m,clamp01((v-stf.c0)/Math.max(1e-8,1-stf.c0)));
}

function normalizationForExport( minimum, maximum )
{
   if ( !isFinite(minimum) || !isFinite(maximum) || minimum > maximum )
      throw new Error( tr( "La sortie contient des valeurs non valides.", "The output contains non-finite values." ) );
   var addition = 0, scale = 1;
   // One affine transform preserves all samples without hard clipping.
   // Samples already in [0,1] are left unchanged.
   if ( minimum < 0 ) addition = -minimum + 0.0001;
   var shiftedMaximum = maximum + addition;
   if ( shiftedMaximum > 1 ) scale = 1/shiftedMaximum;
   if ( !isFinite(addition) || !isFinite(scale) || !(scale > 0) )
      throw new Error( tr( "La plage de sortie ne peut pas être normalisée.", "The output range cannot be normalized." ) );
   return { addition: addition, scale: scale, applied: addition != 0 || scale != 1 };
}

// Vertical count scale only; DATA bins and horizontal values are unchanged.
function histogramCountForScale( count, scale )
{
   switch ( scale )
   {
   case 1: return Math.log( 1 + count );
   case 2: return Math.sqrt( count );
   case 3: return count*count;
   default: return count;
   }
}

// Aggregate only visible high-resolution DATA bins into screen columns.
// No source counts are changed; this is an independent display operation.
function histogramForDisplay( histogram, start, end, columns )
{
   columns = Math.max( 2, Math.round( columns ) );
   var result = new Float64Array( columns );
   var scale = histogram.length - 1;
   var first = Math.max( 0, Math.ceil( start*scale - 1e-9 ) );
   var last = Math.min( scale, Math.floor( end*scale + 1e-9 ) );
   var span = Math.max( 1e-12, end - start );
   for ( var i = first; i <= last; ++i )
   {
      var column = clamp( Math.round( ( i/scale - start )/span*( columns - 1 ) ), 0, columns - 1 );
      result[column] += histogram[i];
   }
   return result;
}

var HistogramControl = class extends Control {
constructor( parent )
{
   super( parent );
   this.hist = [ new Uint32Array( HIST_BINS ) ];
   this.domainMinimum = 0; this.domainMaximum = 1;
   this.seriesColors = [HIST_FINAL_COLOR]; this.seriesLabels = [];
   
   this.scale = P.histScale;
   this.zoom = HIST_ZOOMS[P.histZoomIndex];
   this.start = P.histStart;
   this.setMinSize( this.logicalPixelsToPhysical( 390 ), this.logicalPixelsToPhysical( 170 ) );
   var self = this;

   // PJSR painting callbacks must be assigned explicitly. Defining a class
   // method named onPaint is not sufficient to register the event handler.
   this.onPaint = function( x0, y0, x1, y1 )
   {
      var g = new Graphics( this );
      try
      {
         g.fillRect( x0, y0, x1, y1, new Brush( 0xff151515 ) );
         var lm = 30, rm = 8, tm = self.seriesLabels.length ? 27 : 8, bm = 24;
         var w = Math.max( 1, this.width - lm - rm );
         var h = Math.max( 1, this.height - tm - bm );
         g.pen = new Pen( 0xff6b6b6b, 1 );
         g.drawLine( lm, tm, lm, tm + h );
         g.drawLine( lm, tm + h, lm + w, tm + h );

         var channels = self.hist.map(function(h,index){return index;});
         var colors = self.seriesColors;
         var start = self.start, end = start + 1/self.zoom;
         var columns = Math.max( 2, Math.round( w ) );
         var display = [];
         var maxY = 0;
         for ( var k = 0; k < channels.length; ++k )
         {
            var hh = histogramForDisplay( self.hist[channels[k]], start, end, columns );
            display[k] = hh;
            for ( var i = 0; i < columns; ++i )
               maxY = Math.max( maxY, histogramCountForScale( hh[i], self.scale ) );
         }
         if ( maxY <= 0 ) maxY = 1;

         for ( var k = 0; k < channels.length; ++k )
         {
            var c = channels[k], hh = display[k];
            g.pen = new Pen( colors[c] === undefined ? HIST_FINAL_COLOR : colors[c], 1 );
            var px = lm, py = tm + h;
            for ( var i = 0; i < columns; ++i )
            {
               var xx = lm + Math.round( i*( w - 1 )/( columns - 1 ) );
               var yy = tm + h - Math.round( histogramCountForScale( hh[i], self.scale )*h/maxY );
               if ( i > 0 ) g.drawLine( px, py, xx, yy );
               px = xx; py = yy;
            }
         }

         var legendX = lm;
         for ( var c = 0; c < self.seriesLabels.length; ++c )
         {
            g.pen = new Pen(self.seriesColors[c],1);
            g.drawLine(legendX,13,legendX+12,13);
            g.drawText(legendX+17,17,self.seriesLabels[c]);
            legendX += 17+self.font.width(self.seriesLabels[c])+14;
         }

         var leftLabel = histogramAxisLabel(self.domainMinimum+start*(self.domainMaximum-self.domainMinimum));
         var middleLabel = histogramAxisLabel(self.domainMinimum+(start+0.5/self.zoom)*(self.domainMaximum-self.domainMinimum));
         var rightLabel = histogramAxisLabel(self.domainMinimum+end*(self.domainMaximum-self.domainMinimum));
         g.pen = new Pen( 0xffaaaaaa, 1 );
         g.drawText( lm, tm + h + 17, leftLabel );
         g.drawText( lm + Math.round( ( w - self.font.width( middleLabel ) )/2 ), tm + h + 17, middleLabel );
         g.drawText( lm + w - self.font.width( rightLabel ), tm + h + 17, rightLabel );
      }
      finally
      {
         g.end();
      }
   };
}

setData( h, colors, labels )
{
   this.hist = h;
   this.seriesColors = colors || [HIST_FINAL_COLOR];
   this.seriesLabels = labels || [];
   this.update();
}

setMode( mode )
{
   this.mode = mode;
   this.update();
}

setScale( scale )
{
   this.scale = clamp( Math.round( safeNumber( scale, 1 ) ), 0, 3 );
   this.update();
}

setDomain( minimum, maximum )
{
   this.domainMinimum = minimum; this.domainMaximum = maximum; this.update();
}

setViewport( zoom, start )
{
   this.zoom = clamp( safeNumber( zoom, 1 ), 1, HIST_ZOOMS[HIST_ZOOMS.length - 1] );
   this.start = clamp( safeNumber( start, 0 ), 0, 1 - 1/this.zoom );
   this.update();
}
};

var PreviewBox = class extends ScrollBox {
constructor( parent )
{
   super( parent );
   this.bitmap = null;
   this.zoom = 1;
   this.fit = true;
   this.dragging = false;
   this.dx0 = 0; this.dy0 = 0; this.sx0 = 0; this.sy0 = 0;
   this.autoScroll = true;
   this.tracking = true;
   var self = this;

   this.onHorizontalScrollPosUpdated = function() { this.viewport.update(); };
   this.onVerticalScrollPosUpdated = function() { this.viewport.update(); };
   this.viewport.onResize = function()
   {
      if ( self.fit ) self.zoomFit(); else self.updateRange();
   };
   this.viewport.onMousePress = function( x, y )
   {
      self.dragging = true;
      self.dx0 = x; self.dy0 = y;
      self.sx0 = self.horizontalScrollPosition;
      self.sy0 = self.verticalScrollPosition;
   };
   this.viewport.onMouseRelease = function() { self.dragging = false; };
   this.viewport.onMouseMove = function( x, y )
   {
      if ( self.dragging )
      {
         self.horizontalScrollPosition = self.sx0 + ( self.dx0 - x );
         self.verticalScrollPosition = self.sy0 + ( self.dy0 - y );
      }
   };
   this.viewport.onMouseWheel = function( x, y, delta )
   {
      var z = delta > 0 ? Math.min( self.zoom * 1.25, 8 ) : Math.max( self.zoom * 0.8, 0.05 );
      self.fit = false;
      self.zoomAt( z, x, y );
   };
   this.viewport.onPaint = function( x0, y0, x1, y1 )
   {
      var g = new Graphics( this );
      try
      {
         g.fillRect( x0, y0, x1, y1, new Brush( 0xff181818 ) );
         var bmp = self.bitmap;
         if ( bmp != null )
         {
            var bw = Math.round( bmp.width * self.zoom );
            var bh = Math.round( bmp.height * self.zoom );
            var ox = ( self.maxHorizontalScrollPosition > 0 ) ? -self.horizontalScrollPosition : Math.floor( ( this.width - bw ) / 2 );
            var oy = ( self.maxVerticalScrollPosition > 0 ) ? -self.verticalScrollPosition : Math.floor( ( this.height - bh ) / 2 );
            g.drawScaledBitmap( new Rect( ox, oy, ox + bw, oy + bh ), bmp );
         }
      }
      finally
      {
         g.end();
      }
   };
}

updateRange()
{
   var bmp = this.bitmap;
   if ( bmp == null )
   {
      this.setHorizontalScrollRange( 0, 0 );
      this.setVerticalScrollRange( 0, 0 );
   }
   else
   {
      var bw = Math.round( bmp.width * this.zoom );
      var bh = Math.round( bmp.height * this.zoom );
      this.setHorizontalScrollRange( 0, Math.max( 0, bw - this.viewport.width ) );
      this.setVerticalScrollRange( 0, Math.max( 0, bh - this.viewport.height ) );
   }
   this.viewport.update();
}

zoomAt( z, vx, vy )
{
   var ratio = z / this.zoom;
   this.zoom = z;
   this.updateRange();
   this.horizontalScrollPosition = Math.max( 0, ( this.horizontalScrollPosition + vx ) * ratio - vx );
   this.verticalScrollPosition = Math.max( 0, ( this.verticalScrollPosition + vy ) * ratio - vy );
}

zoomFit()
{
   this.fit = true;
   var bmp = this.bitmap;
   if ( bmp == null )
      return this.updateRange();
   this.zoom = Math.max( 0.05, Math.min( this.viewport.width / bmp.width, this.viewport.height / bmp.height ) );
   this.horizontalScrollPosition = 0;
   this.verticalScrollPosition = 0;
   this.updateRange();
}

zoomOne()
{
   this.fit = false;
   this.zoom = 1;
   this.updateRange();
}

setBitmap( bmp )
{
   this.bitmap = bmp;
   if ( this.fit ) this.zoomFit(); else this.updateRange();
}


};


function activeWeights()
{
   return P.combination == 2 ? P.screenWeights : (P.combination == 1 ? P.lightWeights : P.weights);
}

function activePresets() { return P.combination == 2 ? SCREEN_PRESETS : PRESETS; }

function weightsForCalculation()
{
   var values = activeWeights(), limit = P.combination == 2 ? 1 : 3, w = [], sum = 0;
   for ( var s = 0; s < 3; ++s )
   {
      if ( !isFinite(values[s]) || values[s] < 0 || values[s] > limit )
         throw new Error(tr("Poids invalide : ","Invalid weight: ") + SOURCE_NAMES[s]);
      sum += values[s];
   }
   if ( !(sum > 0) ) throw new Error(tr("Au moins un poids doit être supérieur à zéro.","At least one weight must be greater than zero."));
   for ( var s = 0; s < 3; ++s ) w[s] = values[s]/(P.combination == 0 && P.normalizeWeights ? sum : 1);
   return w;
}

function collectSources( weights )
{
   var views = [null,null,null], width = -1, height = -1;
   for ( var s = 0; s < 3; ++s )
      if ( weights[s] > 0 )
      {
         var v = findView(P.ids[s]);
         if ( v == null ) throw new Error(tr("Source manquante : ","Missing source: ")+SOURCE_NAMES[s]);
         if ( v.image.isColor || v.image.numberOfNominalChannels != 1 )
            throw new Error(SOURCE_NAMES[s]+tr(" doit être monochrome."," must be monochrome."));
         if ( width < 0 ) { width = v.image.width; height = v.image.height; }
         if ( width != v.image.width || height != v.image.height )
            throw new Error(tr("Les sources doivent être alignées et de mêmes dimensions : ","Sources must be registered and have matching dimensions: ")+SOURCE_NAMES[s]);
         views[s] = v;
      }
   // Cache compatible inactive sources too, so a zero weight can be increased live.
   for ( var s = 0; s < 3; ++s )
      if ( views[s] == null )
      {
         var v = findView(P.ids[s]);
         if ( v != null && !v.image.isColor && v.image.numberOfNominalChannels == 1 &&
              v.image.width == width && v.image.height == height ) views[s] = v;
      }
   return { views:views, width:width, height:height };
}

function buildPreviewCache( dialog, force )
{
   var weights = weightsForCalculation(), src = collectSources(weights);
   var maxDim = PREVIEW_SIZES[P.previewSizeIndex];
   var key = JSON.stringify([src.width,src.height,maxDim,src.views.map(function(v){return v == null ? "" : v.id;})]);
   if ( !force && CACHE != null && CACHE.key == key ) return CACHE;
   var step = Math.max(1,Math.ceil(Math.max(src.width,src.height)/maxDim));
   var ww = Math.ceil(src.width/step), wh = Math.ceil(src.height/step), data = [], present = [], minima = [], maxima = [], lowTails = [];
   for ( var s = 0; s < 3; ++s )
   {
      present[s] = src.views[s] != null;
      if ( dialog ) dialog.statusLabel.text = tr("Préparation : ","Preparing: ")+SOURCE_NAMES[s];
      CoreApplication.processEvents();
      data[s] = null;
      if ( present[s] )
      {
         try
         {
            var statistics = {};
            data[s] = blockAverageView(src.views[s],0,step,ww,wh,statistics);
            minima[s] = statistics.minimum; maxima[s] = statistics.maximum;
            lowTails[s] = sampledPercentiles(data[s],[0.001])[0];
         }
         catch ( e )
         {
            if ( weights[s] > 0 ) throw e;
            // An invalid inactive source must not prevent a valid single-filter mix.
            present[s] = false;
         }
      }
   }
   CACHE = { key:key, width:src.width, height:src.height, ww:ww, wh:wh, step:step, data:data, present:present, minima:minima, maxima:maxima, lowTails:lowTails };
   return CACHE;
}

function screenRangeError( source )
{
   return new Error(tr("Screen : la source ","Screen: source ")+SOURCE_NAMES[source]+
      tr(" contient des valeurs hors [0,1]. Préparer une source dans cette plage ou choisir Moyenne / Lighten.",
         " contains values outside [0,1]. Prepare a source in that range or choose Mean / Lighten."));
}

// The same operation is used on reduced sources and full-resolution blocks.
// No hard clipping or automatic input normalization is hidden inside a blend.
function combineInto( out, input, weight, mode, shift, scale )
{
   shift = shift === undefined ? 0 : shift;
   scale = scale === undefined ? 1 : scale;
   for ( var i = 0; i < out.length; ++i )
   {
      var term = weight*((input[i]+shift)*scale);
      if ( mode == 0 ) out[i] += term;
      else if ( mode == 1 ) out[i] = Math.max(out[i],term);
      else out[i] *= 1-term;
   }
}

function initializeMix( count )
{
   var result = new Float64Array(count);
   if ( P.combination != 0 ) result.fill(P.combination == 1 ? -Infinity : 1);
   return result;
}

function finishMix( values )
{
   if ( P.combination == 2 )
      for ( var i = 0; i < values.length; ++i ) values[i] = 1-values[i];
   return values;
}

function footCorrectionEnabled()
{
   return P.separateFootTargets || P.alignHistogramFoot;
}

function sourceFootCorrection( cache, weights )
{
   var correction = { shifts:[0,0,0], lowTails:[null,null,null], scale:1,
      target:P.histFloorTarget, commonTarget:P.histFloorTarget, effectiveTarget:P.histFloorTarget, guarded:false,
      requestedTargets:P.separateFootTargets?P.footTargets.slice(0):[P.histFloorTarget,P.histFloorTarget,P.histFloorTarget],
      targets:[null,null,null], effectiveTargets:[null,null,null], guardedSources:[false,false,false] };
   if ( !footCorrectionEnabled() ) return correction;
   // Common mode raises one shared target. Independent mode protects each
   // requested source target separately, before weights and combination.
   for ( var s = 0; s < 3; ++s )
      if ( weights[s] > 0 )
      {
         if ( !cache.minima || !cache.maxima || !isFinite(cache.minima[s]) || !isFinite(cache.maxima[s]) )
            throw new Error(tr("Préparer l'aperçu pour mesurer les extrema des sources.","Prepare the preview to measure source extrema."));
         var tail = cache.lowTails && isFinite(cache.lowTails[s]) ? cache.lowTails[s] : sampledPercentiles(cache.data[s],[0.001])[0];
         correction.lowTails[s] = tail;
         var target = correction.requestedTargets[s];
         if ( !isFinite(target) || target<0 || target>0.5 )
            throw new Error(tr("Pied cible non valide : ","Invalid foot target: ")+SOURCE_NAMES[s]);
         correction.targets[s] = Math.max(target,0.0001+tail-cache.minima[s]);
         correction.commonTarget = Math.max(correction.commonTarget,correction.targets[s]);
      }
   var maximum = -Infinity;
   for ( var s = 0; s < 3; ++s )
      if ( weights[s] > 0 )
      {
         if ( !P.separateFootTargets ) correction.targets[s] = correction.commonTarget;
         correction.guardedSources[s] = correction.targets[s]>correction.requestedTargets[s];
         correction.guarded = correction.guarded || correction.guardedSources[s];
         correction.shifts[s] = correction.targets[s]-correction.lowTails[s];
         maximum = Math.max(maximum,cache.maxima[s]+correction.shifts[s]);
      }
   // Screen needs bounded inputs. One scale for ALL corrected sources preserves
   // common feet or the ratios between separate feet, without clipping.
   if ( P.combination == 2 && maximum>1 ) correction.scale = (1-4*Number.EPSILON)/maximum;
   correction.effectiveTarget = correction.commonTarget*correction.scale;
   for ( var s = 0; s < 3; ++s )
      if ( weights[s]>0 ) correction.effectiveTargets[s] = correction.targets[s]*correction.scale;
   if ( !isFinite(maximum) || !isFinite(correction.commonTarget) || !(correction.scale>0) )
      throw new Error(tr("Alignement des sources non valide.","Invalid source alignment."));
   return correction;
}

function mixReduced( cache )
{
   var weights = weightsForCalculation();
   for ( var s = 0; s < 3; ++s )
      if ( weights[s] > 0 && !cache.present[s] )
         throw new Error(tr("Sélectionner la source et préparer l'aperçu : ","Select the source and prepare the preview: ")+SOURCE_NAMES[s]);
   var correction = sourceFootCorrection(cache,weights);
   if ( P.combination == 2 )
      for ( var s = 0; s < 3; ++s )
         if ( weights[s] > 0 && ((cache.minima[s]+correction.shifts[s])*correction.scale < 0 ||
                                (cache.maxima[s]+correction.shifts[s])*correction.scale > 1) ) throw screenRangeError(s);
   var n = cache.ww*cache.wh, out = new Float32Array(n), hist = new Uint32Array(HIST_BINS);
   var combined = initializeMix(n);
   for ( var s = 0; s < 3; ++s )
      if ( weights[s] > 0 ) combineInto(combined,cache.data[s],weights[s],P.combination,correction.shifts[s],correction.scale);
   finishMix(combined);
   var low = 0, high = 0, minimum = Infinity, maximum = -Infinity;
   for ( var i = 0; i < n; ++i )
   {
      var value = combined[i];
      if ( !isFinite(value) ) throw new Error(tr("Valeur non valide dans le mélange.","Non-finite sample in the mix."));
      out[i] = value;
      minimum = Math.min(minimum,value); maximum = Math.max(maximum,value);
      if ( value < 0 ) ++low;
      if ( value > 1 ) ++high;
      ++hist[Math.round(clamp01(value)*(HIST_BINS-1))];
   }
   return { out:out, hist:[hist], low:low, high:high, minimum:minimum, maximum:maximum, n:n, floorCorrection:correction, weights:weights };
}

function preparePreviewDisplay( cache, mix )
{
   var minimum = mix.minimum, maximum = mix.maximum;
   if ( P.combination == 1 && cache.maxima )
   {
      // For nonnegative gains, max_pixel(max_source(gain*source)) equals
      // max_source(gain*sourceMaximum). Preserve even isolated full-size peaks
      // lost during preview reduction instead of scaling to the reduced maximum.
      var weights = weightsForCalculation(), fullMaximum = -Infinity;
      for ( var s = 0; s < 3; ++s )
         if ( weights[s] > 0 )
         {
            if ( !isFinite(cache.maxima[s]) ) throw new Error(tr("Rafraîchir l'aperçu pour mesurer les maxima.","Refresh the preview to measure source maxima."));
            var correction = mix.floorCorrection;
            var sourceMaximum = correction ? (cache.maxima[s]+correction.shifts[s])*correction.scale : cache.maxima[s];
            fullMaximum = Math.max(fullMaximum,weights[s]*sourceMaximum);
         }
      maximum = Math.max(maximum,fullMaximum);
   }
   var transform = normalizationForExport(minimum,maximum);
   var values = new Float32Array(mix.n), histogram = new Uint32Array(HIST_BINS);
   for ( var i = 0; i < mix.n; ++i )
   {
      var value = Math.fround((mix.out[i]+transform.addition)*transform.scale);
      if ( !isFinite(value) || value < 0 || value > 1 )
         throw new Error(tr("Valeur d'affichage non valide.","Invalid display sample."));
      values[i] = value;
      // Histogram and preview share this exact pre-STF range. Do not bin raw
      // values with clamp01: that piles every raw value >1 into the last bin.
      ++histogram[Math.round(value*(HIST_BINS-1))];
   }
   var stf = null;
   if ( P.useSTF )
   {
      // Median and MAD must be measured after range normalization, before
      // applying a display-only stretch. Clamping raw >1 values loses detail.
      var median = percentileFromHistogram(fineHistogramOfArray(values,65536),50);
      stf = stfFromStatistics(median,madFromArray(values,median,65536));
   }
   return { values:values, hist:[histogram], transform:transform, stf:stf };
}

function histogramAxisLabel( value )
{
   if ( value==0 ) return "0";
   if ( Math.abs(value)>=10000 || Math.abs(value)<0.0001 ) return value.toExponential(2);
   return value.toFixed(4).replace(/\.?0+$/,"");
}

function selectedHistogram( cache, mix, selection )
{
   if ( selection==4 || selection==5 ) return overlayHistogram(cache,mix,selection==5);
   var source=[-1,1,2,0][selection]; // Final, Ha, OIII, SII.
   var empty={hist:[new Uint32Array(HIST_BINS)],minimum:0,maximum:1,source:source,available:false};
   if ( cache==null || mix==null ) return empty;
   if ( selection==0 && !mix.displayHistogram ) return empty;
   if ( selection==0 ) return {hist:mix.displayHistogram,minimum:0,maximum:1,source:-1,
      available:true,n:mix.n,low:mix.low,high:mix.high,inactive:false,colors:[HIST_FINAL_COLOR],labels:[tr("Finale","Final")]};
   if ( source==null || !cache.present[source] ) return empty;
   if ( !mix.sourceHistograms ) mix.sourceHistograms=[];
   if ( mix.sourceHistograms[source] ) return mix.sourceHistograms[source];
   var weights=mix.weights || weightsForCalculation(),correction=mix.floorCorrection;
   var shifts=[0,0,0],scales=[1,1,1],minimum=0,maximum=1;
   // Same data axis for all available sources. Expand it rather than clipping
   // negative samples or >1 samples; do not rescale individual histograms.
   for ( var s=0;s<3;++s )
      if ( cache.present[s] )
      {
         if ( weights[s]>0 && correction ) {shifts[s]=correction.shifts[s];scales[s]=correction.scale;}
         minimum=Math.min(minimum,(cache.minima[s]+shifts[s])*scales[s]);
         maximum=Math.max(maximum,(cache.maxima[s]+shifts[s])*scales[s]);
      }
   if ( !isFinite(minimum) || !isFinite(maximum) || !(maximum>minimum) )
      throw new Error(tr("Plage d'histogramme source non valide.","Invalid source histogram range."));
   var data=cache.data[source],histogram=new Uint32Array(HIST_BINS),low=0,high=0,span=maximum-minimum;
   for ( var i=0;i<data.length;++i )
   {
      var value=(data[i]+shifts[source])*scales[source];
      if ( !isFinite(value) ) throw new Error(tr("Pixel non valide dans l'histogramme source.","Invalid pixel in source histogram."));
      if ( value<0 ) ++low;if ( value>1 ) ++high;
      // The common full-resolution range contains all reduced source samples.
      // Clamp only the integer bin index against floating-point endpoint drift.
      var bin=clamp(Math.round((value-minimum)/span*(HIST_BINS-1)),0,HIST_BINS-1);
      ++histogram[bin];
   }
   var result={hist:[histogram],minimum:minimum,maximum:maximum,source:source,
      available:true,n:data.length,low:low,high:high,inactive:weights[source]==0,
      colors:[HIST_SOURCE_COLORS[source]],labels:[SOURCE_NAMES[source]]};
   mix.sourceHistograms[source]=result;
   return result;
}

function overlayHistogram( cache, mix, includeFinal )
{
   var result={hist:[],colors:[],labels:[],minimum:0,maximum:1,available:false,
      overlay:true,includeFinal:includeFinal,missing:[],inactiveSources:[]};
   if ( cache==null || mix==null ) {result.hist=[new Uint32Array(HIST_BINS)];return result;}
   if ( !mix.overlayHistograms ) mix.overlayHistograms={};
   var key=includeFinal?"sourcesFinal":"sources";
   if ( mix.overlayHistograms[key] ) return mix.overlayHistograms[key];
   for ( var s=0;s<3;++s )
   {
      var sourceHistogram=selectedHistogram(cache,mix,[3,1,2][s]);
      if ( !sourceHistogram.available ) {result.missing.push(SOURCE_NAMES[s]);continue;}
      result.hist.push(sourceHistogram.hist[0]);result.colors.push(HIST_SOURCE_COLORS[s]);result.labels.push(SOURCE_NAMES[s]);
      result.minimum=sourceHistogram.minimum;result.maximum=sourceHistogram.maximum;
      if ( sourceHistogram.inactive ) result.inactiveSources.push(SOURCE_NAMES[s]);
   }
   if ( includeFinal && mix.displayHistogram )
   {
      var histogram=mix.displayHistogram[0];
      if ( result.minimum!=0 || result.maximum!=1 )
      {
         // Rebin actual normalized pre-STF samples, not rounded histogram bin
         // centers, onto the SAME real-value axis as the corrected sources.
         histogram=new Uint32Array(HIST_BINS);
         var transform=mix.displayTransform,span=result.maximum-result.minimum;
         if ( !transform ) transform=preparePreviewDisplay(cache,mix).transform;
         for ( var i=0;i<mix.n;++i )
         {
            var value=Math.fround((mix.out[i]+transform.addition)*transform.scale);
            var bin=clamp(Math.round((value-result.minimum)/span*(HIST_BINS-1)),0,HIST_BINS-1);
            ++histogram[bin];
         }
      }
      result.hist.push(histogram);result.colors.push(HIST_FINAL_COLOR);result.labels.push(tr("Finale","Final"));
   }
   result.available=result.hist.length>0;
   if ( !result.available ) result.hist=[new Uint32Array(HIST_BINS)];
   mix.overlayHistograms[key]=result;
   return result;
}

function previewBitmap( cache, mix )
{
   var image = new Image(cache.ww,cache.wh,1,ColorSpace.Gray,32,PixelSampleType.Float);
   try
   {
      var display = preparePreviewDisplay(cache,mix);
      mix.displayTransform = display.transform;
      mix.displayHistogram = display.hist;
      var samples = new Float32Array(mix.n);
      for ( var i = 0; i < mix.n; ++i ) samples[i] = display.stf == null ? display.values[i] : applySTF(display.values[i],display.stf);
      image.setSamples(samples,new Rect(0,0,cache.ww,cache.wh),0);
      return image.render();
   }
   finally { image.free(); }
}

function readMixedBlock( sources, weights, rect, count, correction )
{
   if ( correction == null ) correction = {shifts:[0,0,0],scale:1};
   var out = initializeMix(count);
   for ( var s = 0; s < 3; ++s )
      if ( weights[s] > 0 )
      {
         var input = new Float64Array(count);
         sources.views[s].image.getSamples(input,rect,0);
         for ( var i = 0; i < count; ++i )
         {
            if ( !isFinite(input[i]) ) throw new Error(tr("Pixel source non valide : ","Non-finite source pixel: ")+SOURCE_NAMES[s]);
            var adjusted = (input[i]+correction.shifts[s])*correction.scale;
            if ( P.combination == 2 && (adjusted < 0 || adjusted > 1) ) throw screenRangeError(s);
         }
         combineInto(out,input,weights[s],P.combination,correction.shifts[s],correction.scale);
      }
   return finishMix(out);
}

function fullRender( dialog )
{
   var weights = weightsForCalculation(), sources = collectSources(weights);
   var correction = {shifts:[0,0,0],scale:1,guarded:false};
   // Re-read originals for export so the guard and percentile cannot be based
   // on stale minima. Cache preparation never calls mixReduced or fullRender.
   if ( footCorrectionEnabled() ) correction = sourceFootCorrection(buildPreviewCache(dialog,true),weights);
   var W = sources.width, H = sources.height, minimum = Infinity, maximum = -Infinity;
   // Validate and measure the actual full-resolution mix, never the reduced preview.
   for ( var y = 0; y < H; y += BLOCK_ROWS )
   {
      var bottom = Math.min(H,y+BLOCK_ROWS), rect = new Rect(0,y,W,bottom);
      var samples = readMixedBlock(sources,weights,rect,W*(bottom-y),correction);
      for ( var i = 0; i < samples.length; ++i )
      {
         var value = samples[i];
         if ( !isFinite(value) ) throw new Error(tr("Mélange non valide.","Invalid mix."));
         minimum = Math.min(minimum,value); maximum = Math.max(maximum,value);
      }
      if ( dialog ) dialog.statusLabel.text = format(tr("Vérification : %.0f %%","Checking: %.0f %%"),100*bottom/H);
      CoreApplication.processEvents();
   }
   var transform = normalizationForExport(minimum,maximum);
   var id = validId("SHO_Luminance_"+["Mean","Lighten","Screen"][P.combination]);
   var window = new ImageWindow(W,H,1,32,true,false,id);
   if ( window == null || window.isNull ) throw new Error(tr("Création de l'image impossible.","Cannot create the image."));
   var view = window.mainView, completed = false;
   view.beginProcess(UndoFlag.NoSwapFile);
   try
   {
      for ( var y = 0; y < H; y += BLOCK_ROWS )
      {
         var bottom = Math.min(H,y+BLOCK_ROWS), rect = new Rect(0,y,W,bottom);
         var raw = readMixedBlock(sources,weights,rect,W*(bottom-y),correction), out = new Float32Array(raw.length);
         for ( var i = 0; i < raw.length; ++i )
         {
            var value = Math.fround((raw[i]+transform.addition)*transform.scale);
            if ( !isFinite(value) || value < 0 || value > 1 ) throw new Error(tr("Valeur de sortie invalide.","Invalid output sample."));
            out[i] = value;
         }
         view.image.setSamples(out,rect,0);
         if ( dialog ) dialog.statusLabel.text = format(tr("Création : %.0f %%","Rendering: %.0f %%"),100*bottom/H);
         CoreApplication.processEvents();
      }
      view.image.resetSelections();
      completed = true;
   }
   finally { view.endProcess(); if ( !completed ) window.forceClose(); }
   console.writeln(TITLE+" "+VERSION+" — "+id);
   console.writeln("SII="+P.ids[0]+" | Ha="+P.ids[1]+" | OIII="+P.ids[2]);
   console.writeln(["Mean / Somme", "Lighten / Maximum", "Screen / Ecran"][P.combination]+" | "+
      ["Linear sources", "Nonlinear sources"][P.sourceMode]);
   console.writeln(format("SII %.8f | Ha %.8f | OIII %.8f",weights[0],weights[1],weights[2]));
   if ( footCorrectionEnabled() )
   {
      console.writeln(P.separateFootTargets?tr("Pieds séparés AVANT combinaison","Separate feet BEFORE combination"):tr("Pied commun AVANT combinaison","Common foot BEFORE combination"));
      for ( var s=0;s<3;++s ) if ( weights[s]>0 )
         console.writeln(SOURCE_NAMES[s]+format(tr(" : cible %.4f | pied effectif %.8f | décalage %.8f | protection minima : "," : target %.4f | effective foot %.8f | shift %.8f | minimum guard: "),correction.requestedTargets[s],correction.effectiveTargets[s],correction.shifts[s])+correction.guardedSources[s]);
      console.writeln(format(tr("Facteur commun sources %.8f","Common source scale %.8f"),correction.scale));
      console.writeln(format(tr("Décalages AVANT combinaison : SII %.8f | Ha %.8f | OIII %.8f","Shifts BEFORE combination: SII %.8f | Ha %.8f | OIII %.8f"),correction.shifts[0],correction.shifts[1],correction.shifts[2]));
   }
   console.writeln(format("min %.8f | max %.8f | addition %.8f | scale %.8f",minimum,maximum,transform.addition,transform.scale));
   // No STF or permanent stretch is applied to the output.
   window.show(); window.zoomToFit();
   if ( dialog ) dialog.statusLabel.text = id + (transform.applied ? format(tr(" — remise à l'échelle ×%.6f"," — rescaled ×%.6f"),transform.scale) : tr(" — créée"," — created"));
   return window;
}

function makeLabel( parent, text )
{
   var label = new Label(parent); label.text = text; return label;
}

function makeCombo( parent, items, index, callback )
{
   var combo = new ComboBox(parent);
   items.forEach(function(item){combo.addItem(item);});
   combo.currentItem = index; combo.onItemSelected = callback; return combo;
}

function makeButton( parent, text, callback )
{
   var button = new PushButton(parent); button.text = text; button.onClick = callback; return button;
}

function makeFootControl( parent, text, value, callback )
{
   var control=new NumericControl(parent);
   control.label.text=text;control.label.minWidth=parent.font.width(tr("Pied commun :","Common foot:"))+8;
   control.setReal(true);control.setRange(0,0.5);control.setPrecision(4);control.enableFixedPrecision(true);
   control.sliderValueToControl=function(tick){return clamp(Math.round(tick),0,5000)/10000;};
   control.controlValueToSlider=function(value){return clamp(Math.round(value*10000),0,5000);};
   control.slider.setRange(0,5000);control.slider.stepSize=1;control.slider.pageSize=1;
   control.setValue(value);control.onValueUpdated=callback;
   for(let direction of [-1,1])
   {
      let button=new ToolButton(control);button.text=direction<0?"−":"+";button.setScaledFixedSize(22,22);
      button.toolTip=tr("Modifier le pied cible de 0,0001.","Adjust the foot target by 0.0001.");
      button.onClick=function(){
         control.evaluate();var value=clamp(Math.round(control.value*10000)+direction,0,5000)/10000;
         control.setValue(value);control.onValueUpdated(value);
      };
      control.sizer.add(button);
      if(direction<0)control.decreaseButton=button;else control.increaseButton=button;
   }
   return control;
}

var LuminanceDialog = class extends Dialog {
constructor()
{
   super();
   var self = this;
   this.windowTitle = TITLE + " " + VERSION;
   this.updating = false; this.busy = false; this.relaunch = false; this.lastMix = null;
   this.histogramMinimum=0;this.histogramMaximum=1;
   this.onClose = function(){ if ( self.busy ) return false; self.timer.stop(); return true; };

   this.titleLabel = makeLabel(this,"<b>"+TITLE+" "+VERSION+"</b> — Philippe Bernhard — SII · Ha · OIII → L");
   this.titleLabel.useRichText = true;
   this.languageCombo = makeCombo(this,["Français","English"],P.language == "en" ? 1 : 0,function(index){
      if ( self.updating || self.busy ) return;
      var language = index == 1 ? "en" : "fr";
      if ( language == P.language ) return;
      self.timer.stop(); P.language = language; self.relaunch = true; self.ok();
   });
   var header = new HorizontalSizer; header.spacing = 8;
   header.add(this.titleLabel); header.addStretch(); header.add(this.languageCombo);
   var subtitle = makeLabel(this,tr(
      "Luminance synthétique par mélange pondéré. Sources alignées, de mêmes dimensions et au même stade de traitement. La STF agit uniquement sur l'aperçu.",
      "Synthetic luminance by weighted mixing. Sources must be registered, have matching dimensions and be at the same processing stage. STF affects the preview only."));
   subtitle.wordWrapping = true;

   this.sourcesGroup = new GroupBox(this); this.sourcesGroup.title = tr("Sources monochromes","Monochrome sources");
   this.sourceLists = [];
   var sourcesSizer = new VerticalSizer; sourcesSizer.margin = 6; sourcesSizer.spacing = 5;
   for ( let s = 0; s < 3; ++s )
   {
      let row = new HorizontalSizer; row.spacing = 6;
      let label = makeLabel(this.sourcesGroup,SOURCE_NAMES[s]+" :"); label.setMinWidth(this.font.width("OIII :")+8);
      let list = new ViewList(this.sourcesGroup); list.getMainViews();
      let view = findView(P.ids[s]); if ( view != null ) list.currentView = view;
      list.onViewSelected = function(v){
         if ( self.updating ) return;
         P.ids[s] = v == null || v.isNull ? "" : v.id;
         self.invalidatePreview();
      };
      this.sourceLists.push(list); row.add(label); row.add(list,100); sourcesSizer.add(row);
   }
   this.sourcesGroup.sizer = sourcesSizer;

   this.weightsGroup = new GroupBox(this); this.weightsGroup.title = tr("Mixage 3 → 1","3 → 1 mix");
   var weightsSizer = new VerticalSizer; weightsSizer.margin = 6; weightsSizer.spacing = 5;
   this.combinationCombo = makeCombo(this.weightsGroup,[tr("Moyenne / Somme","Mean / Sum"),"Lighten / Maximum",tr("Screen / Écran","Screen")],P.combination,function(index){
      if(self.updating || self.busy || index==P.combination)return;
      self.commitEdits(); self.timer.stop(); P.combination=index;
      self.updateCombinationControls(); self.schedulePreview();
   });
   var combinationRow=new HorizontalSizer; combinationRow.spacing=5;
   combinationRow.add(makeLabel(this.weightsGroup,tr("Combinaison :","Combination:"))); combinationRow.add(this.combinationCombo,100);
   weightsSizer.add(combinationRow);
   this.weightControls = [];
   for ( let s = 0; s < 3; ++s )
   {
      let control = new NumericControl(this.weightsGroup);
      control.label.text = SOURCE_NAMES[s]+" (%) :";
      control.label.minWidth = this.font.width("OIII (%) :")+8;
      control.setReal(true); control.setRange(0,300); control.setPrecision(1); control.enableFixedPrecision(true);
      control.sliderValueToControl = function(tick){return clamp(Math.round(tick),0,P.combination==2?1000:3000)/10;};
      control.controlValueToSlider = function(value){return clamp(Math.round(value*10),0,P.combination==2?1000:3000);};
      control.slider.setRange(0,3000); control.slider.stepSize = 1; control.slider.pageSize = 10;
      control.setValue(activeWeights()[s]*100);
      control.toolTip = tr("Poids relatif de 0 à 300 %. Zéro exclut cette source du calcul.","Relative weight from 0 to 300%. Zero excludes this source from the calculation.");
      control.onValueUpdated = function(value){
         if ( self.updating ) return;
         activeWeights()[s] = Math.round(clamp(value,0,P.combination==2?100:300)*10)/1000;
         self.updateFormula(); self.schedulePreview();
      };
      this.weightControls.push(control); weightsSizer.add(control);
   }
   this.normalizeCheck = new CheckBox(this.weightsGroup);
   this.normalizeCheck.text = tr("Normaliser les poids (Moyenne)","Normalize weights (Mean)");
   this.normalizeCheck.checked = P.normalizeWeights;
   this.normalizeCheck.toolTip = tr(
      "Activé : divise le mélange par la somme des poids. Désactivé : utilise les coefficients saisis directement, comme SHORGB.",
      "Enabled: divides the mix by the weight sum. Disabled: uses the entered coefficients directly, as in SHORGB.");
   this.normalizeCheck.onCheck = function(value){if(self.updating)return; P.normalizeWeights=value; self.updateFormula(); self.schedulePreview();};
   weightsSizer.add(this.normalizeCheck);
   this.formulaLabel = makeLabel(this.weightsGroup,""); this.formulaLabel.wordWrapping = true;
   weightsSizer.add(this.formulaLabel);
   this.combinationHelp = makeLabel(this.weightsGroup,""); this.combinationHelp.wordWrapping=true;
   weightsSizer.add(this.combinationHelp);
   this.presetCombo = makeCombo(this.weightsGroup,[
      tr("Égal : 1 / 1 / 1","Equal: 1 / 1 / 1"), "Ha ×2 : 1 / 2 / 1", "Ha ×3 : 1 / 3 / 1", "HO : 0 / 1 / 1",
      tr("SII seule","SII only"), tr("Ha seule","Ha only"), tr("OIII seule","OIII only"), tr("Personnalisé","Custom")
   ],0,function(index){self.presetButton.enabled=index<activePresets().length;});
   this.presetButton = makeButton(this.weightsGroup,tr("Appliquer","Apply"),function(){
      var preset=activePresets()[self.presetCombo.currentItem];if(preset)self.setWeights(preset);
   });
   var presets = new HorizontalSizer; presets.spacing=5; presets.add(this.presetCombo,100); presets.add(this.presetButton);
   weightsSizer.add(presets);
   this.footCheck=new CheckBox(this.weightsGroup);
   this.footCheck.text=tr("Utiliser un pied commun","Use a common foot target");
   this.footCheck.checked=P.alignHistogramFoot;
   this.footCheck.toolTip=tr(
      "Active uniquement le mode pied commun, avant les poids et la combinaison. La case Utiliser des pieds séparés est indépendante et prioritaire ; elle active directement ses trois réglages. Les originaux restent intacts.",
      "Enables common-foot mode only, before weights and combination. Use separate foot targets is independent and takes priority; it activates its three controls directly. Originals remain unchanged.");
   this.footCheck.onCheck=function(value){
      if(self.updating)return;P.alignHistogramFoot=value;self.updateFootControls();self.schedulePreview();
   };
   weightsSizer.add(this.footCheck);
   this.floorTargetControl=makeFootControl(this.weightsGroup,tr("Pied commun :","Common foot:"),P.histFloorTarget,function(value){
      if(self.updating)return;P.histFloorTarget=Math.round(clamp(safeNumber(value,P.histFloorTarget),0,0.5)*10000)/10000;
      self.schedulePreview();
   });
   this.floorTargetControl.toolTip=tr(
      "Cible commune avant les poids : 0,0000 à 0,5000 ; pas 0,0001. La protection peut relever la cible des trois sources ensemble. En Screen, un facteur commun peut ramener les sources alignées dans [0,1] en préservant leur pied commun. Les gains et la combinaison interviennent ensuite.",
      "Shared target before weights: 0.0000 to 0.5000; step 0.0001. The guard may raise the target for all sources together. In Screen, one common factor can fit aligned sources into [0,1] while preserving their common foot. Gains and combination follow afterwards.");
   weightsSizer.add(this.floorTargetControl);
   this.advancedCheck=new CheckBox(this.weightsGroup);this.advancedCheck.checked=P.showAdvanced;
   this.advancedCheck.onCheck=function(value){
      if(self.updating)return;P.showAdvanced=value;self.updateFootControls();
   };
   this.advancedCheck.toolTip=tr("Afficher ou masquer le panneau des pieds séparés. Replier le panneau conserve les réglages actifs.","Show or hide the separate-foot panel. Collapsing it keeps the settings active.");
   weightsSizer.add(this.advancedCheck);this.weightsGroup.sizer=weightsSizer;

   this.advancedGroup=new GroupBox(this);this.advancedGroup.title=tr("Réglages avancés — pieds par source","Advanced settings — source feet");
   this.separateFeetCheck=new CheckBox(this.advancedGroup);
   this.separateFeetCheck.text=tr("Utiliser des pieds séparés","Use separate foot targets");
   this.separateFeetCheck.toolTip=tr(
      "Cette case active directement les pieds SII, Ha et OIII, même si le pied commun est désactivé et même si le panneau avancé est ensuite replié.",
      "This checkbox directly activates the SII, Ha and OIII feet even when common-foot mode is off, including after the advanced panel is collapsed.");
   this.separateFeetCheck.checked=P.separateFootTargets;
   this.separateFeetCheck.onCheck=function(value){
      if(self.updating)return;self.commitEdits();P.separateFootTargets=value;self.updateFootControls();self.schedulePreview();
   };
   var advancedSizer=new VerticalSizer;advancedSizer.margin=6;advancedSizer.spacing=5;
   advancedSizer.add(this.separateFeetCheck);
   this.sourceFloorControls=[];
   for(let s=0;s<3;++s)
   {
      let control=makeFootControl(this.advancedGroup,tr("Pied ","Foot ")+SOURCE_NAMES[s]+" :",P.footTargets[s],function(value){
         if(self.updating)return;P.footTargets[s]=Math.round(clamp(safeNumber(value,P.footTargets[s]),0,0.5)*10000)/10000;
         self.schedulePreview();
      });
      control.toolTip=tr("Cible de cette source AVANT les poids : 0 à 0,5000, pas 0,0001. La protection peut relever ce pied seul si nécessaire. Le Screen peut appliquer un facteur commun aux trois sources.","This source's target BEFORE weights: 0 to 0.5000, step 0.0001. The guard may raise this foot alone if required. Screen may apply a common scale to all sources.");
      this.sourceFloorControls.push(control);advancedSizer.add(control);
   }
   this.copyFootButton=makeButton(this.advancedGroup,tr("Copier le pied commun vers les trois sources","Copy common foot to all three sources"),function(){
      self.commitEdits();self.updating=true;
      try{for(var s=0;s<3;++s){P.footTargets[s]=P.histFloorTarget;self.sourceFloorControls[s].setValue(P.histFloorTarget);}}
      finally{self.updating=false;}
      self.schedulePreview();
   });
   advancedSizer.add(this.copyFootButton);this.advancedGroup.sizer=advancedSizer;

   this.displayGroup = new GroupBox(this); this.displayGroup.title = tr("Affichage de l'aperçu","Preview display");
   this.sourceModeCombo=makeCombo(this.displayGroup,[tr("Linéaires","Linear"),tr("Non linéaires","Nonlinear")],P.sourceMode,function(index){
      if(self.updating || self.busy)return;
      P.sourceMode=index; P.useSTF=index==0;
      self.stfCheck.checked=P.useSTF; self.stfCombo.enabled=P.useSTF; self.schedulePreview();
   });
   this.sourceModeCombo.toolTip=tr(
      "Déclaration du stade des sources, sans transformation des données. Linéaires : STF activée par défaut ; non linéaires : affichage direct. Vous pouvez ensuite modifier la STF.",
      "Declares the processing stage without transforming data. Linear: STF enabled by default; nonlinear: direct display. You can then override STF.");
   this.stfCheck = new CheckBox(this.displayGroup); this.stfCheck.text = tr("STF automatique (affichage seul)","Auto STF (display only)");
   this.stfCheck.checked = P.useSTF;
   this.stfCheck.onCheck = function(value){
      P.useSTF=value; self.stfCombo.enabled=value; self.schedulePreview();
   };
   this.stfCombo = makeCombo(this.displayGroup,[tr("Faible","Low"),tr("Moyen","Medium"),tr("Fort","High")],P.stfLevel,function(index){
      P.stfLevel=index; self.schedulePreview();
   });
   this.stfCombo.enabled=P.useSTF;
   this.qualityCombo = makeCombo(this.displayGroup,["1200 px","1800 px","2400 px"],P.previewSizeIndex,function(index){
      if(self.updating)return; P.previewSizeIndex=index; self.invalidatePreview();
   });
   var displaySizer = new VerticalSizer; displaySizer.margin=6; displaySizer.spacing=5;
   var sourceModeRow=new HorizontalSizer;sourceModeRow.spacing=5;
   sourceModeRow.add(makeLabel(this.displayGroup,tr("Sources :","Sources:")));sourceModeRow.add(this.sourceModeCombo,100);
   displaySizer.add(sourceModeRow);
   displaySizer.add(this.stfCheck);
   var displayRow = new HorizontalSizer; displayRow.spacing=5;
   displayRow.add(makeLabel(this.displayGroup,tr("Niveau :","Level:"))); displayRow.add(this.stfCombo);
   displayRow.addStretch(); displayRow.add(makeLabel(this.displayGroup,tr("Aperçu :","Preview:"))); displayRow.add(this.qualityCombo);
   displaySizer.add(displayRow); this.displayGroup.sizer=displaySizer;

   this.histGroup = new GroupBox(this); this.histGroup.title = tr("Histogramme — avant STF","Histogram — before STF");
   this.histControl = new HistogramControl(this.histGroup);
   this.histControl.toolTip=tr(
      "Final : mélange remis à l'échelle, avant STF. Ha / OIII / SII : sources après correction du pied et facteur commun Screen éventuel, avant les poids et la combinaison. Les sources partagent un axe de valeurs réelles, élargi si nécessaire. Une source à poids nul est affichée brute, sans correction.",
      "Final: range-normalized mix before STF. Ha / OIII / SII: sources after foot correction and any common Screen scale, before weights and combination. Source plots share a real-value axis, expanded if needed. A zero-weight source is shown raw without correction.");
   this.histViewCombo=makeCombo(this.histGroup,[tr("Luminance finale","Final luminance"),"Ha","OIII","SII",tr("SII + Ha + OIII superposés","SII + Ha + OIII overlay"),tr("SII + Ha + OIII + finale","SII + Ha + OIII + final")],P.histView,function(index){
      if(self.updating)return;P.histView=index;self.updateSelectedHistogram();
   });
   var histViewRow=new HorizontalSizer;histViewRow.spacing=5;
   histViewRow.add(makeLabel(this.histGroup,tr("Afficher :","Show:")));histViewRow.add(this.histViewCombo,100);
   this.histScaleCombo = makeCombo(this.histGroup,[tr("Linéaire","Linear"),tr("Logarithme","Logarithm"),tr("Racine carrée","Square root"),tr("Carré","Square")],P.histScale,function(index){
      P.histScale=index; self.histControl.setScale(index);
   });
   this.histZoomCombo = makeCombo(this.histGroup,HIST_ZOOMS.map(function(z){return "×"+z;}),P.histZoomIndex,function(index){self.setHistogramViewport(index,P.histStart);});
   this.histStartControl = new NumericEdit(this.histGroup); this.histStartControl.label.text=tr("Début :","Start:");
   this.histStartControl.setReal(true); this.histStartControl.setPrecision(4); this.histStartControl.enableFixedPrecision(true);
   this.histStartControl.onValueUpdated=function(value){
      if(!self.updating)self.setHistogramViewport(P.histZoomIndex,(value-self.histogramMinimum)/(self.histogramMaximum-self.histogramMinimum));
   };
   this.setHistogramViewport(P.histZoomIndex,P.histStart);
   this.clipLabel = makeLabel(this.histGroup,tr("Aucun aperçu calculé.","No preview calculated.")); this.clipLabel.wordWrapping=true;
   var histogramSizer = new VerticalSizer; histogramSizer.margin=6; histogramSizer.spacing=5;
   var histogramRow = new HorizontalSizer; histogramRow.spacing=5;
   histogramRow.add(this.histScaleCombo); histogramRow.addStretch(); histogramRow.add(this.histZoomCombo); histogramRow.add(this.histStartControl);
   histogramSizer.add(histViewRow);histogramSizer.add(histogramRow); histogramSizer.add(this.histControl,100); histogramSizer.add(this.clipLabel);
   this.histGroup.sizer=histogramSizer;

   this.previewBox = new PreviewBox(this); this.previewBox.setScaledMinSize(550,420);
   this.statusLabel=makeLabel(this,tr("Sélectionner les sources puis préparer l'aperçu.","Select the sources, then prepare the preview."));
   this.statusLabel.wordWrapping=true;
   this.prepareButton=makeButton(this,tr("Préparer / rafraîchir","Prepare / refresh"),function(){self.preparePreview();});
   this.fitButton=makeButton(this,tr("Ajuster","Fit"),function(){self.previewBox.zoomFit();});
   this.oneButton=makeButton(this,"100 %",function(){self.previewBox.zoomOne();});
   this.oneButton.toolTip=tr("Un pixel de l'aperçu réduit = un pixel écran.","One reduced-preview pixel = one screen pixel.");
   var previewTools=new HorizontalSizer; previewTools.spacing=5;
   previewTools.add(this.prepareButton); previewTools.add(this.fitButton); previewTools.add(this.oneButton); previewTools.addStretch();
   var right=new VerticalSizer; right.spacing=6; right.add(previewTools); right.add(this.previewBox,100); right.add(this.advancedGroup);right.add(this.statusLabel);
   var left=new VerticalSizer; left.spacing=6;
   left.add(this.sourcesGroup); left.add(this.weightsGroup); left.add(this.displayGroup); left.add(this.histGroup,100);
   var columns=new HorizontalSizer; columns.spacing=8; columns.add(left); columns.add(right,100);

   this.newInstanceButton=new ToolButton(this);
   this.newInstanceButton.icon=this.scaledResource(":/process-interface/new-instance.png"); this.newInstanceButton.setScaledFixedSize(24,24);
   this.newInstanceButton.toolTip=tr("Glisser le triangle sur le bureau PixInsight pour mémoriser les sources et réglages.","Drag the triangle onto the PixInsight workspace to save sources and settings.");
   this.newInstanceButton.onMousePress=function(){
      if(self.busy)return; self.commitEdits(); this.hasFocus=true; this.pushed=false;
      exportInstanceParameters(); self.newInstance();
   };
   this.resetButton=makeButton(this,tr("Réinitialiser","Reset"),function(){
      var ids=P.ids.slice(0), language=P.language; P=cloneDefaults(); P.ids=ids; P.language=language;
      self.refreshControls(); self.invalidatePreview();
   });
   this.applyButton=makeButton(this,tr("Créer la luminance","Create luminance"),function(){
      self.runBusy(function(){self.commitEdits(); fullRender(self); saveSettings();});
   });
   this.applyButton.toolTip=tr(
      "Crée une image monochrome 32 bits depuis les sources originales, sans appliquer la STF. Une translation et une remise à l'échelle préservent les écarts si la sortie dépasse [0,1].",
      "Creates a 32-bit grayscale image from the original sources without applying STF. A shift and rescaling preserve differences if the output exceeds [0,1].");
   this.closeButton=makeButton(this,tr("Fermer","Close"),function(){if(self.busy)return;self.commitEdits();self.timer.stop();self.ok();});
   var buttons=new HorizontalSizer; buttons.spacing=6;
   buttons.add(this.newInstanceButton); buttons.add(this.resetButton); buttons.addStretch(); buttons.add(this.applyButton); buttons.add(this.closeButton);
   this.sizer=new VerticalSizer; this.sizer.margin=8; this.sizer.spacing=6;
   this.sizer.add(header); this.sizer.add(subtitle); this.sizer.add(columns,100); this.sizer.add(buttons);

   this.timer=new Timer; this.timer.periodic=false; this.timer.interval=0.2;
   this.timer.onTimeout=function(){self.refreshPreview();};
   this.updateCombinationControls();this.updateFootControls();this.updateSelectedHistogram(); this.adjustToContents();
   this.setScaledMinSize(1120,820);
}

commitEdits()
{
   for(var s=0;s<3;++s)
   {
      this.weightControls[s].evaluate();
      activeWeights()[s]=Math.round(clamp(this.weightControls[s].value,0,P.combination==2?100:300)*10)/1000;
   }
   this.floorTargetControl.evaluate();
   P.histFloorTarget=Math.round(clamp(this.floorTargetControl.value,0,0.5)*10000)/10000;
   for(var s=0;s<3;++s)
   {
      this.sourceFloorControls[s].evaluate();P.footTargets[s]=Math.round(clamp(this.sourceFloorControls[s].value,0,0.5)*10000)/10000;
   }
   this.histStartControl.evaluate();
   this.setHistogramViewport(P.histZoomIndex,(this.histStartControl.value-this.histogramMinimum)/(this.histogramMaximum-this.histogramMinimum));
   this.updateFormula();
}

runBusy( callback )
{
   if(this.busy)return;
   this.timer.stop(); this.busy=true; this.enabled=false;
   try { callback(); }
   catch(e) { this.statusLabel.text=errText(e); showError(this,errText(e)); }
   finally { this.enabled=true; this.busy=false; }
}

invalidatePreview()
{
   if(this.timer)this.timer.stop(); CACHE=null; this.lastMix=null;
   if(this.previewBox)this.previewBox.setBitmap(null);
   if(this.histControl)this.histControl.setData([new Uint32Array(HIST_BINS)]);
   if(this.histControl)
   {
      this.histogramMinimum=0;this.histogramMaximum=1;this.histControl.setDomain(0,1);
      this.setHistogramViewport(P.histZoomIndex,P.histStart);
   }
   if(this.clipLabel)this.clipLabel.text=tr("Aucun aperçu à jour.","No current preview.");
   if(this.statusLabel)this.statusLabel.text=tr("Sources ou résolution modifiées : préparer / rafraîchir.","Sources or resolution changed: prepare / refresh.");
}

preparePreview()
{
   var self=this;
   this.runBusy(function(){self.commitEdits(); self.invalidatePreview(); buildPreviewCache(self,true); self.renderPreview();});
}

schedulePreview()
{
   if(this.updating || this.busy)return;
   if(CACHE==null)
   {
      this.statusLabel.text=tr("Préparer l'aperçu pour activer le réglage interactif.","Prepare the preview to enable interactive adjustments.");
      return;
   }
   // Keep a scheduled frame while the slider moves continuously.
   if(!this.timer.isRunning)this.timer.start();
}

renderPreview()
{
   if(CACHE==null)return;
   var start=Date.now(), mix=mixReduced(CACHE);
   this.previewBox.setBitmap(previewBitmap(CACHE,mix));this.lastMix=mix;this.updateSelectedHistogram();
   this.statusLabel.text=format(tr("Aperçu %d × %d — %.2f s","Preview %d × %d — %.2f s"),CACHE.ww,CACHE.wh,(Date.now()-start)/1000);
   if(footCorrectionEnabled())
   {
      var feet=mix.floorCorrection.effectiveTargets;
      var footLabels=[];
      for(var s=0;s<3;++s)footLabels.push(SOURCE_NAMES[s]+" "+(feet[s]==null?"—":feet[s].toFixed(5)));
      this.statusLabel.text+=tr(" — pieds effectifs : "," — effective feet: ")+footLabels.join(" / ")+
         (mix.floorCorrection.guarded?tr(" (protection minima)"," (minimum guard)"):"");
   }
   if(mix.displayTransform && mix.displayTransform.applied)
      this.statusLabel.text+=format(tr(" — affichage remis à l'échelle : ajout %.5f, ×%.5f"," — display rescaled: addition %.5f, ×%.5f"),mix.displayTransform.addition,mix.displayTransform.scale);
   if(P.combination!=0 && CACHE.step>1)this.statusLabel.text+=tr(" — estimation sur sources réduites."," — estimate from reduced sources.");
}

refreshPreview()
{
   if(this.busy || CACHE==null)return;
   this.busy=true;
   try { this.renderPreview(); }
   catch(e)
   {
      // A previous bitmap must not be presented as the result of invalid weights.
      this.previewBox.setBitmap(null); this.histControl.setData([new Uint32Array(HIST_BINS)]); this.lastMix=null;
      this.clipLabel.text=tr("Aperçu non valide.","Invalid preview."); this.statusLabel.text=errText(e);
   }
   finally { this.busy=false; }
}

setWeights( values )
{
   var target=activeWeights();
   this.updating=true;
   try
   {
      for(var s=0;s<3;++s)
      {
         target[s]=clamp(values[s],0,P.combination==2?1:3);
         this.weightControls[s].setValue(target[s]*100);
      }
   }
   finally { this.updating=false; }
   this.updateFormula(); this.schedulePreview();
}

updateFormula()
{
   var presets=activePresets(), values=activeWeights(), preset = presets.length;
   for(var p=0;p<presets.length;++p)
      if(presets[p].every(function(w,s){return Math.abs(w-values[s])<1e-9;})){preset=p;break;}
   this.presetCombo.currentItem=preset; this.presetButton.enabled=preset<presets.length;
   try
   {
      var w=weightsForCalculation();
      if(P.combination==1)this.formulaLabel.text=format("L = max(%.3f SII ; %.3f Ha ; %.3f OIII)",w[0],w[1],w[2]);
      else if(P.combination==2)this.formulaLabel.text=format("L = 1 − (1 − %.3f SII)(1 − %.3f Ha)(1 − %.3f OIII)",w[0],w[1],w[2]);
      else this.formulaLabel.text=P.normalizeWeights ?
         format(tr("Contributions : SII %.2f %% · Ha %.2f %% · OIII %.2f %%","Contributions: SII %.2f%% · Ha %.2f%% · OIII %.2f%%"),100*w[0],100*w[1],100*w[2]) :
         format("L = %.3f SII + %.3f Ha + %.3f OIII",w[0],w[1],w[2]);
   }
   catch(e) { this.formulaLabel.text=errText(e); }
}

updateCombinationControls()
{
   var wasUpdating=this.updating;this.updating=true;
   try
   {
      var screen=P.combination==2, limit=screen?100:300, values=activeWeights();
      this.combinationCombo.currentItem=P.combination;
      for(var s=0;s<3;++s)
      {
         var control=this.weightControls[s];
         control.setRange(0,limit);control.slider.setRange(0,limit*10);control.setValue(values[s]*100);
         control.toolTip=screen ? tr("Opacité de 0 à 100 %. Zéro exclut la source. Les pixels de la source doivent être dans [0,1].","Opacity from 0 to 100%. Zero excludes the source. Source pixels must be in [0,1].") :
            (P.combination==1 ? tr("Gain de 0 à 300 %, appliqué avant de prendre le maximum. Zéro exclut la source.","Gain from 0 to 300%, applied before taking the maximum. Zero excludes the source.") :
            tr("Poids de 0 à 300 %. Zéro exclut la source.","Weight from 0 to 300%. Zero excludes the source."));
      }
      this.normalizeCheck.enabled=P.combination==0;this.normalizeCheck.checked=P.normalizeWeights;
      this.combinationHelp.text=[
         tr("Poids relatifs ; désactiver la normalisation pour une somme directe.","Relative weights; disable normalization for a direct sum."),
         tr("Gains avant maximum. Aucune division par la somme des poids.","Gains before maximum. No division by the weight sum."),
         tr("Opacités indépendantes. Sources dans [0,1] ; aucun écrêtage des entrées.","Independent opacities. Sources in [0,1]; no input clipping.")
      ][P.combination];
      this.presetCombo.clear();
      var labels=screen ? ["100 / 100 / 100", "50 / 100 / 50", "33.3 / 100 / 33.3", "0 / 100 / 100"] :
         [tr("Égal : 1 / 1 / 1","Equal: 1 / 1 / 1"),"Ha ×2 : 1 / 2 / 1","Ha ×3 : 1 / 3 / 1","HO : 0 / 1 / 1"];
      labels=labels.concat([tr("SII seule","SII only"),tr("Ha seule","Ha only"),tr("OIII seule","OIII only"),tr("Personnalisé","Custom")]);
      for(var label of labels)this.presetCombo.addItem(label);
   }
   finally {this.updating=wasUpdating;}
   this.updateFormula();
}

setHistogramViewport( index, start )
{
   P.histZoomIndex=clamp(Math.round(index),0,HIST_ZOOMS.length-1);
   P.histStart=clamp(safeNumber(start,0),0,1-1/HIST_ZOOMS[P.histZoomIndex]);
   this.histZoomCombo.currentItem=P.histZoomIndex;
   var minimum=this.histogramMinimum,span=this.histogramMaximum-minimum;
   this.histStartControl.setRange(minimum,minimum+(1-1/HIST_ZOOMS[P.histZoomIndex])*span);
   this.histStartControl.setValue(minimum+P.histStart*span);
   this.histStartControl.enabled=P.histZoomIndex>0;
   this.histControl.setViewport(HIST_ZOOMS[P.histZoomIndex],P.histStart);
}

updateSelectedHistogram()
{
   var labels=[tr("Luminance finale","Final luminance"),"Ha","OIII","SII","SII + Ha + OIII",tr("SHO + finale","SHO + final")];
   this.histGroup.title=tr("Histogramme — ","Histogram — ")+labels[P.histView]+tr(" (avant STF)"," (before STF)");
   var histogram=selectedHistogram(CACHE,this.lastMix,P.histView);
   this.histogramMinimum=histogram.minimum;this.histogramMaximum=histogram.maximum;
   this.histControl.setDomain(histogram.minimum,histogram.maximum);this.histControl.setData(histogram.hist,histogram.colors,histogram.labels);
   this.setHistogramViewport(P.histZoomIndex,P.histStart);
   if(!histogram.available)
   {
      this.clipLabel.text=CACHE==null?tr("Préparer l'aperçu pour afficher l'histogramme.","Prepare the preview to display the histogram."):
         labels[P.histView]+tr(" : source non disponible pour cet aperçu.",": source unavailable in this preview.");
      return;
   }
   if(histogram.overlay)
   {
      this.clipLabel.text=tr("Sources avant poids","Sources before weights")+
         (histogram.includeFinal?tr(" ; finale après remise à l'échelle","; final after range normalization"):"");
      if(histogram.missing.length)this.clipLabel.text+=tr(" — absentes : "," — missing: ")+histogram.missing.join(", ");
      if(histogram.inactiveSources.length)this.clipLabel.text+=tr(" — poids nul, brutes : "," — zero weight, raw: ")+histogram.inactiveSources.join(", ");
      return;
   }
   var prefix=P.histView==0?tr("Mélange avant remise à l'échelle","Mix before range normalization"):
      labels[P.histView]+(histogram.inactive?tr(" — poids nul, source brute"," — zero weight, raw source"):tr(" — avant poids"," — before weights"));
   this.clipLabel.text=prefix+format(" : < 0 : %.4f %% | > 1 : %.4f %%",100*histogram.low/histogram.n,100*histogram.high/histogram.n);
}

updateFootControls()
{
   this.footCheck.enabled=!P.separateFootTargets;
   this.floorTargetControl.enabled=P.alignHistogramFoot && !P.separateFootTargets;
   this.advancedCheck.text=tr("Réglages avancés","Advanced settings")+
      (P.separateFootTargets?tr(" (pieds séparés)"," (separate feet)"):"");
   this.advancedGroup.visible=P.showAdvanced;
   this.copyFootButton.enabled=P.separateFootTargets;
   for(var s=0;s<3;++s)this.sourceFloorControls[s].enabled=P.separateFootTargets;
}

refreshControls()
{
   this.updating=true;
   try
   {
      this.updateCombinationControls();this.sourceModeCombo.currentItem=P.sourceMode;
      this.normalizeCheck.checked=P.normalizeWeights; this.stfCheck.checked=P.useSTF;
      this.footCheck.checked=P.alignHistogramFoot;this.floorTargetControl.setValue(P.histFloorTarget);
      this.advancedCheck.checked=P.showAdvanced;this.separateFeetCheck.checked=P.separateFootTargets;
      for(var s=0;s<3;++s)this.sourceFloorControls[s].setValue(P.footTargets[s]);
      this.updateFootControls();
      this.stfCombo.currentItem=P.stfLevel; this.stfCombo.enabled=P.useSTF;
      this.qualityCombo.currentItem=P.previewSizeIndex; this.histScaleCombo.currentItem=P.histScale;
      this.histControl.setScale(P.histScale); this.setHistogramViewport(P.histZoomIndex,P.histStart);
      this.histViewCombo.currentItem=P.histView;this.updateSelectedHistogram();
   }
   finally { this.updating=false; }
   this.updateFormula();
}
};

function main()
{
   loadSettings(); CACHE=null;
   var dialog=null, state=null;
   try
   {
      for(;;)
      {
         dialog=new LuminanceDialog;
         if(state!=null)
         {
            dialog.resize(state.width,state.height);
            dialog.presetCombo.currentItem=state.preset;
            if(CACHE!=null)
            {
               dialog.renderPreview(); dialog.previewBox.fit=state.fit; dialog.previewBox.zoom=state.zoom;
               if(state.fit)dialog.previewBox.zoomFit(); else dialog.previewBox.updateRange();
               dialog.previewBox.horizontalScrollPosition=state.x; dialog.previewBox.verticalScrollPosition=state.y;
            }
         }
         dialog.execute(); dialog.timer.stop(); dialog.commitEdits();
         var relaunch=dialog.relaunch;
         state=relaunch ? {width:dialog.width,height:dialog.height,preset:dialog.presetCombo.currentItem,
            fit:dialog.previewBox.fit,zoom:dialog.previewBox.zoom,x:dialog.previewBox.horizontalScrollPosition,y:dialog.previewBox.verticalScrollPosition} : null;
         dialog.timer.onTimeout=null; dialog.previewBox.setBitmap(null); dialog.lastMix=null; dialog=null;
         if(!relaunch)break;
      }
      saveSettings();
   }
   finally
   {
      if(dialog!=null){dialog.timer.stop();dialog.timer.onTimeout=null;dialog.previewBox.setBitmap(null);dialog.lastMix=null;}
      CACHE=null;
   }
}

main();
