#engine v8

#feature-id    SHORGB_AIP : CCD1024 > SHORGB-AIP
#feature-icon  @script_icons_dir/AIP.svg
#feature-info  Interactive six-source SII/Ha/OIII/R/G/B matrix mixer for PixInsight 1.9.4+. \
   18 independent coefficients, live preview with Linked STF / Unlinked STF / Linear and Low / Medium / High STF levels, RGB/L histogram, clipping monitor, positive histogram-foot alignment, independent coarse and fine signed R/G/B offsets and full-resolution output. English/French interface.

/*
 * SHORGB-AIP 1.02
 * Philippe Bernhard
 * PixInsight >= 1.9.4 / PJSR V8
 *
 * Original implementation for a 6 -> 3 narrowband/RGB matrix mixer.
 * PreviewBox and helper functions reuse and adapt Badassium238 1.2.3 code.
 * No Badassium238 colour-separation algorithm is reused here.
 */

/*
 * Code reused and adapted from Badassium238 1.2.3 by Jacques Pouyaud:
 * PreviewBox, findView(), validId() and errText(). These components are
 * reused code, not merely architectural inspiration. Preview painting and
 * range handling have been adapted for SHORGB-AIP and SHOLuminance-AIP.
 * Upstream: https://github.com/jps-34/Badassium238
 * The following MIT notice applies to these reused portions:
 * 
 * MIT License
 * 
 * Copyright (c) 2026 Jacques Pouyaud
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

var TITLE = "SHORGB-AIP";
var VERSION = "1.02";
// Preserve existing preferences and process-icon parameters after the rename.
var INSTANCE_KEY = "NB_RGB_Matrix_Mixer_configuration";
var SETTINGS_KEY = "NB_RGB_Matrix_Mixer/settings_v02";
var LANGUAGE_KEY = "SHORGB-AIP/language";

var SOURCE_NAMES = [ "SII", "Ha", "OIII", "R", "G", "B" ];
var OUTPUT_NAMES = [ "R", "G", "B" ];
var HIST_BINS = 16384; // Fine DATA bins preserve detail under horizontal zoom.
var BLOCK_ROWS = 128;
var PREVIEW_SIZES = [ 1200, 1800, 2400 ];
var HIST_ZOOMS = [ 1, 2, 5, 10, 20 ];
var STF_TARGETS = [ 0.15, 0.25, 0.35 ]; // Low / Medium / High display median targets.

var PRESET_MATRICES = [
   [ [1,0,0,0,0,0], [0,1,0,0,0,0], [0,0,1,0,0,0] ], // SHO
   [ [0,1,0,0,0,0], [0,0.5,0.5,0,0,0], [0,0,1,0,0,0] ], // HOO
   [ [0,0,0,1,0,0], [0,0,0,0,1,0], [0,0,0,0,0,1] ], // RGB
   [ [0.8,0,0,0.2,0,0], [0,0.8,0,0,0.2,0], [0,0,0.8,0,0,0.2] ], // SHORGB 80/20
   [ [0,0.8,0,0.2,0,0], [0,0.4,0.4,0,0.2,0], [0,0,0.8,0,0,0.2] ], // HOORGB 80/20
   [ [0,0,0,0,0,0], [0,0,0,0,0,0], [0,0,0,0,0,0] ] // Zero
];
var PRESET_CUSTOM = PRESET_MATRICES.length;

function presetIndexForMatrix( matrix )
{
   for ( var preset = 0; preset < PRESET_MATRICES.length; ++preset )
   {
      var matches = true;
      for ( var row = 0; row < 3 && matches; ++row )
         for ( var source = 0; source < 6; ++source )
            if ( Math.abs( matrix[row][source] - PRESET_MATRICES[preset][row][source] ) > 1e-9 )
            {
               matches = false;
               break;
            }
      if ( matches ) return preset;
   }
   return PRESET_CUSTOM;
}

var DEFAULTS = {
   language: "fr",
   showAdvanced: false,
   ids: [ "", "", "", "", "", "" ],
   weights: [
      [ 1, 0, 0, 0, 0, 0 ],
      [ 0, 1, 0, 0, 0, 0 ],
      [ 0, 0, 1, 0, 0, 0 ]
   ],
   mode: 0,                 // 0 linear, 1 non-linear (informational)
   backgroundNormalization: false, // Positive histogram-foot alignment (legacy setting name)
   histFloorTarget: 0.0050,
   offsetsCoarse: [ 0.000, 0.000, 0.000 ], // R, G, B: +/-0.2, step 0.001
   offsetsFine: [ 0.0000, 0.0000, 0.0000 ], // R, G, B: +/-0.02, step 0.0001
   linearDisplayMode: 0, // 0 Linked STF, 1 Unlinked STF, 2 Linear
   stfLevel: 1,          // 0 Low, 1 Medium (historical STF), 2 High
   displayGamma: 0.35,
   previewSizeIndex: 1,
   histMode: 0,             // 0 RGB, 1 R, 2 G, 3 B, 4 L
   histScale: 1,            // 0 linear, 1 logarithm, 2 square root, 3 square
   histZoomIndex: 0,        // Horizontal zoom: x1, x2, x5, x10, x20
   histStart: 0             // Left edge of the visible DATA interval
};

var P = null;
var CACHE = null;

// FR/EN selector follows the interface pattern shown in Badassium238
// (Jacques Pouyaud); all image-processing operations remain those of SHORGB-AIP.
function tr( french, english )
{
   return P != null && P.language == "en" ? english : french;
}

function preferredLanguage()
{
   try
   {
      var language = Settings.read( LANGUAGE_KEY, DataType.String );
      if ( language == "fr" || language == "en" ) return language;
   }
   catch ( e ) {}
   return "fr";
}

function cloneDefaults()
{
   return JSON.parse( JSON.stringify( DEFAULTS ) );
}

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

function roundedOffset( value, limit, precision )
{
   var scale = Math.pow( 10, precision );
   return Math.round( clamp( safeNumber( value, 0 ), -limit, limit )*scale )/scale;
}

function effectiveOffsets()
{
   var offsets = [];
   for ( var c = 0; c < 3; ++c )
      offsets[c] = roundedOffset( P.offsetsCoarse[c] + P.offsetsFine[c], 0.22, 4 );
   return offsets;
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

function loadSettings()
{
   P = cloneDefaults();
   P.language = preferredLanguage();
   try
   {
      // A process icon owns its settings; ordinary launches use saved preferences.
      var fromInstance = (Parameters.isGlobalTarget || Parameters.isViewTarget) &&
                         Parameters.has( INSTANCE_KEY );
      var s = fromInstance ? Parameters.getString( INSTANCE_KEY ) :
                             Settings.read( SETTINGS_KEY, DataType.String );
      if ( s == null || s.length == 0 )
         return;
      var o = JSON.parse( s );
      if ( o.language == "fr" || o.language == "en" ) P.language = o.language;
      P.showAdvanced = !!o.showAdvanced;
      if ( o.ids && o.ids.length == 6 )
         P.ids = o.ids.slice( 0 );
      if ( o.weights && o.weights.length == 3 )
      {
         var ok = true;
         for ( var r = 0; r < 3; ++r )
            ok = ok && o.weights[r] && o.weights[r].length == 6;
         if ( ok )
         {
            P.weights = [ [], [], [] ];
            for ( var r = 0; r < 3; ++r )
               for ( var c = 0; c < 6; ++c )
                  P.weights[r][c] = clamp( safeNumber( o.weights[r][c], DEFAULTS.weights[r][c] ), 0, 3 );
         }
      }
      P.mode = Math.round( safeNumber( o.mode, P.mode ) );
      P.backgroundNormalization =
         ( o.backgroundNormalization === undefined ) ?
            P.backgroundNormalization :
            !!o.backgroundNormalization;
      P.histFloorTarget = clamp( safeNumber( o.histFloorTarget, P.histFloorTarget ), 0, 0.5 );
      var hasCoarse = Array.isArray( o.offsetsCoarse ) && o.offsetsCoarse.length == 3;
      var hasFine = Array.isArray( o.offsetsFine ) && o.offsetsFine.length == 3;
      var hasOffsets = Array.isArray( o.offsets ) && o.offsets.length == 3;
      var oldOffset = clamp( safeNumber( o.rgbOffset, 0 ), 0, 0.1 );
      for ( var c = 0; c < 3; ++c )
      {
         if ( hasCoarse || hasFine )
         {
            P.offsetsCoarse[c] = roundedOffset( hasCoarse ? o.offsetsCoarse[c] : 0, 0.2, 3 );
            P.offsetsFine[c] = roundedOffset( hasFine ? o.offsetsFine[c] : 0, 0.02, 4 );
         }
         else
         {
            // Migrate earlier per-channel or common offsets, preserving the total
            // wherever the new combined range [-0.22,+0.22] permits it.
            var total = roundedOffset( hasOffsets ? o.offsets[c] : oldOffset, 0.22, 4 );
            P.offsetsCoarse[c] = roundedOffset( total, 0.2, 3 );
            P.offsetsFine[c] = roundedOffset( total - P.offsetsCoarse[c], 0.02, 4 );
         }
      }
      // Legacy output-clipping choices are ignored; export normalization is automatic.
      P.linearDisplayMode = o.linearDisplayMode === undefined ? (o.autoDisplay === false ? 2 : 0) : clamp(Math.round(safeNumber(o.linearDisplayMode, 0)), 0, 2);
      P.stfLevel = clamp( Math.round( safeNumber( o.stfLevel, P.stfLevel ) ), 0, STF_TARGETS.length - 1 );
      P.displayGamma = clamp( safeNumber( o.displayGamma, P.displayGamma ), 0.10, 1.00 );
      P.previewSizeIndex = clamp( Math.round( safeNumber( o.previewSizeIndex, P.previewSizeIndex ) ), 0, PREVIEW_SIZES.length - 1 );
      P.histMode = clamp( Math.round( safeNumber( o.histMode, P.histMode ) ), 0, 4 );
      P.histScale = clamp( Math.round( safeNumber( o.histScale, P.histScale ) ), 0, 3 );
      P.histZoomIndex = clamp( Math.round( safeNumber( o.histZoomIndex, 0 ) ), 0, HIST_ZOOMS.length - 1 );
      P.histStart = clamp( safeNumber( o.histStart, 0 ), 0, 1 - 1/HIST_ZOOMS[P.histZoomIndex] );
   }
   catch ( e )
   {
      P = cloneDefaults();
      P.language = preferredLanguage();
   }
}

function saveSettings()
{
   try
   {
      Settings.write( SETTINGS_KEY, DataType.String, JSON.stringify( P ) );
      Settings.write( LANGUAGE_KEY, DataType.String, P.language );
   }
   catch ( e )
   {
   }
}

function exportInstanceParameters()
{
   Parameters.set( INSTANCE_KEY, JSON.stringify( P ) );
}

function sourceChannel( sourceIndex, image )
{
   if ( sourceIndex < 3 )
      return 0;
   if ( !image.isColor || image.numberOfChannels < 3 )
      return 0;
   return sourceIndex - 3;
}

function matrixForCalculation()
{
   // V0.2.3: matrix coefficients are always used exactly as entered.
   // Optional positive-foot alignment and coarse + fine RGB offsets follow the matrix.
   // Coefficients are never rescaled or renormalized.
   var m = [ [], [], [] ];
   for ( var o = 0; o < 3; ++o )
      for ( var s = 0; s < 6; ++s )
         m[o][s] = P.weights[o][s];
   return m;
}

function sourceNeeded( sourceIndex, matrix )
{
   for ( var o = 0; o < 3; ++o )
      if ( Math.abs( matrix[o][sourceIndex] ) > 1e-12 )
         return true;
   return false;
}

function collectSources( matrix, requireNB )
{
   var views = new Array( 6 );
   var channels = new Array( 6 );
   var width = -1, height = -1;

   for ( var s = 0; s < 6; ++s )
   {
      var required = requireNB ? ( s < 3 ) : sourceNeeded( s, matrix );
      var v = findView( P.ids[s] );
      if ( v == null )
      {
         if ( required )
            throw new Error( tr( "Source manquante : ", "Missing source: " ) + SOURCE_NAMES[s] );
         views[s] = null;
         channels[s] = 0;
         continue;
      }

      if ( s < 3 && required && v.image.isColor )
         throw new Error( SOURCE_NAMES[s] + tr( " doit être une image monochrome.", " must be a monochrome image." ) );

      if ( width < 0 )
      {
         width = v.image.width;
         height = v.image.height;
      }
      else if ( v.image.width != width || v.image.height != height )
      {
         throw new Error( tr( "Toutes les sources utilisées doivent être alignées et avoir les mêmes dimensions.\n", "All sources in use must be aligned and have the same dimensions.\n" ) +
                          SOURCE_NAMES[s] + " : " + v.image.width + " × " + v.image.height +
                          tr( " ; référence : ", "; reference: " ) + width + " × " + height + "." );
      }

      views[s] = v;
      channels[s] = sourceChannel( s, v.image );
   }

   if ( width < 0 )
      throw new Error( tr( "Aucune source utilisable n'est sélectionnée.", "No usable source is selected." ) );

   return { views: views, channels: channels, width: width, height: height };
}

function cacheKey( src, maxDim )
{
   var a = [ src.width, src.height, maxDim ];
   for ( var s = 0; s < 6; ++s )
      a.push( src.views[s] == null ? "-" : src.views[s].id + "#" + src.channels[s] );
   return JSON.stringify( a );
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
   if ( statistics )
   {
      statistics.minimum = isFinite(minimum) ? minimum : 0;
      statistics.maximum = isFinite(maximum) ? maximum : 0;
   }
   return out;
}

function buildPreviewCache( dialog, force, matrix )
{
   var m = matrix == null ? matrixForCalculation() : matrix;
   var src = collectSources( m, false );

   var maxDim = PREVIEW_SIZES[P.previewSizeIndex];
   var key = cacheKey( src, maxDim );

   if ( !force && CACHE != null && CACHE.key == key )
      return CACHE;

   var step = Math.max( 1, Math.ceil( Math.max( src.width, src.height ) / maxDim ) );
   var ww = Math.ceil( src.width / step );
   var wh = Math.ceil( src.height / step );
   var data = new Array( 6 );
   var minima = new Array( 6 ), maxima = new Array( 6 );
   var memo = {}, memoMinima = {}, memoMaxima = {};

   if ( dialog )
   {
      dialog.statusLabel.text = tr( "<b>Préparation du preview...</b>", "<b>Preparing preview...</b>" );
      CoreApplication.processEvents();
   }

   for ( var s = 0; s < 6; ++s )
   {
      if ( src.views[s] == null )
      {
         data[s] = new Float32Array( ww * wh );
         minima[s] = 0;
         maxima[s] = 0;
         continue;
      }
      var mk = src.views[s].id + "#" + src.channels[s];
      if ( memo[mk] !== undefined )
      {
         data[s] = memo[mk];
         minima[s] = memoMinima[mk];
         maxima[s] = memoMaxima[mk];
         continue;
      }

      if ( dialog )
      {
         dialog.statusLabel.text = tr( "Préparation : ", "Preparing: " ) + SOURCE_NAMES[s] + "…";
         CoreApplication.processEvents();
      }
      var statistics = {};
      data[s] = blockAverageView( src.views[s], src.channels[s], step, ww, wh, statistics );
      minima[s] = statistics.minimum;
      maxima[s] = statistics.maximum;
      memo[mk] = data[s];
      memoMinima[mk] = minima[s];
      memoMaxima[mk] = maxima[s];
   }

   CACHE = {
      key: key,
      width: src.width,
      height: src.height,
      step: step,
      ww: ww,
      wh: wh,
      data: data,
      minima: minima, // True full-resolution source extrema, before block averaging.
      maxima: maxima,
      rangeCache: [], // Exact mixed ranges for recent matrices; offsets need no rescan.
      present: src.views.map( function( v ) { return v != null; } )
   };

   if ( dialog )
      dialog.statusLabel.text = format( tr( "Preview prêt : %dx%d (réduction ×%d)", "Preview ready: %dx%d (downsampled ×%d)" ), ww, wh, step );

   return CACHE;
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

// ============================================================================
// Positive histogram-foot alignment: additive translations, never a white-point
// normalization. The 0.1th percentile identifies the low tail on the preview.
// A full-resolution lower bound prevents the automatic shift creating negatives:
//   bound[c] = sum( weight[c][s] * trueSourceMinimum[s] ), for nonnegative weights.
//   shift[c] = max( target - lowTail[c], 0.0001 - bound[c] ).
// Manual coarse + fine offsets are added afterwards and can lower this margin.
// ============================================================================

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

function histogramFootCorrection( raw, cache, matrix )
{
   if ( !cache.minima || cache.minima.length != 6 )
      throw new Error( tr( "Préparer/rafraîchir le preview pour mesurer les minima des sources.", "Prepare/refresh the preview to measure the source minima." ) );
   var result = { shifts: [], lowTails: [], lowerBounds: [], guarded: [], target: P.histFloorTarget };
   for ( var c = 0; c < 3; ++c )
   {
      var lowerBound = 0;
      for ( var source = 0; source < 6; ++source )
      {
         if ( matrix[c][source] < 0 )
            throw new Error( tr( "Le pied protégé nécessite des coefficients de mixage positifs ou nuls.", "The protected histogram foot requires nonnegative mixing coefficients." ) );
         lowerBound += matrix[c][source]*cache.minima[source];
      }
      var lowTail = sampledPercentiles( raw[c], [0.001] )[0];
      var requestedShift = P.histFloorTarget - lowTail;
      var safeShift = 0.0001 - lowerBound;
      result.shifts[c] = Math.max( requestedShift, safeShift );
      result.lowTails[c] = lowTail;
      result.lowerBounds[c] = lowerBound;
      result.guarded[c] = safeShift > requestedShift;
   }
   return result;
}

function estimateMixedFootCorrection( cache, matrix )
{
   var n = cache.ww*cache.wh;
   var raw = [ new Float32Array( n ), new Float32Array( n ), new Float32Array( n ) ];
   for ( var i = 0; i < n; ++i )
      for ( var c = 0; c < 3; ++c )
      {
         var value = 0;
         for ( var source = 0; source < 6; ++source )
            if ( matrix[c][source] != 0 ) value += matrix[c][source]*cache.data[source][i];
         raw[c][i] = value;
      }
   return histogramFootCorrection( raw, cache, matrix );
}

// Auto SHO compares the source signal between the low tail and percentile 90.
// No histogram peak or white point is used in this estimate.
function autoSHOSignal( values )
{
   if ( values.length < 16 )
      throw new Error( tr( "Auto SHO : pas assez de pixels pour analyser les sources.", "Auto SHO: not enough pixels to analyse the sources." ) );
   var percentiles = sampledPercentiles( values, [0.001, 0.9] );
   var signal = percentiles[1] - percentiles[0];
   if ( !( signal > 1e-10 ) )
      throw new Error( tr( "Auto SHO : signal insuffisant au-dessus du pied dans une des sources.", "Auto SHO: insufficient signal above the histogram foot in one of the sources." ) );
   return { signal: signal, lowTail: percentiles[0] };
}

function calculateAutoSHO( cache )
{
   var stats = [];
   for ( var c = 0; c < 3; ++c )
   {
      if ( !cache.present[c] )
         throw new Error( tr( "Auto SHO : source manquante : ", "Auto SHO: missing source: " ) + SOURCE_NAMES[c] );
      stats[c] = autoSHOSignal( cache.data[c] );
   }
   // Symmetric reference: no single source is assumed to have the correct gain.
   var reference = Math.exp( ( Math.log( stats[0].signal ) + Math.log( stats[1].signal ) + Math.log( stats[2].signal ) )/3 );
   var coefficients = [], weights = [ [0,0,0,0,0,0], [0,0,0,0,0,0], [0,0,0,0,0,0] ];
   for ( var c = 0; c < 3; ++c )
   {
      coefficients[c] = Math.round( clamp( reference/stats[c].signal, 0.2, 2.5 )*1000 )/1000;
      weights[c][c] = coefficients[c];
   }
   return { weights: weights, coefficients: coefficients, statistics: stats };
}

function zeroHist4()
{
   return [ new Uint32Array( HIST_BINS ), new Uint32Array( HIST_BINS ),
            new Uint32Array( HIST_BINS ), new Uint32Array( HIST_BINS ) ];
}

function mixReduced( cache, dialog )
{
   var matrix = matrixForCalculation(), offsets = effectiveOffsets();
   for ( var source = 0; source < 6; ++source )
      if ( sourceNeeded(source,matrix) && !cache.present[source] )
         throw new Error(tr("Source manquante pour le preview : ","Missing source for the preview: ") + SOURCE_NAMES[source] +
                         tr(". Sélectionner la source puis rafraîchir.",". Select the source and refresh."));

   var correction = P.backgroundNormalization ? estimateMixedFootCorrection(cache,matrix) :
      { shifts: [0,0,0], lowTails: [], lowerBounds: [], guarded: [false,false,false], target: P.histFloorTarget };
   // The same full-resolution extrema and affine transform as the final output.
   // Block-averaged pixels only estimate the shape/counts of the histogram.
   var range = rangeAfterAdjustments(previewMixedRanges(cache,matrix,dialog),correction.shifts,offsets);
   var transform = normalizationForExport(range.minimum,range.maximum);
   var n = cache.ww*cache.wh;
   var out = [new Float32Array(n),new Float32Array(n),new Float32Array(n)];
   var hist = zeroHist4(), low = [0,0,0], high = [0,0,0];
   for ( var i = 0; i < n; ++i )
   {
      for ( var channel = 0; channel < 3; ++channel )
      {
         var value = 0;
         for ( var source = 0; source < 6; ++source )
            if ( matrix[channel][source] != 0 ) value += matrix[channel][source]*cache.data[source][i];
         value = value + correction.shifts[channel] + offsets[channel];
         var stored = normalizedOutputSample(value,transform,true);
         out[channel][i] = stored;
         if ( stored < 0 ) ++low[channel];
         if ( stored > 1 ) ++high[channel];
         ++hist[channel][Math.round(stored*(HIST_BINS-1))];
      }
      var luminance = 0.2126*out[0][i] + 0.7152*out[1][i] + 0.0722*out[2][i];
      ++hist[3][Math.round(clamp01(luminance)*(HIST_BINS-1))];
   }
   return { out: out, hist: hist, low: low, high: high, n: n,
            floorCorrection: correction, offsets: offsets.slice(0),
            transform: transform, range: range };
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

// Pooled RGB median and MAD: one identical transform for all channels.
function linkedSTFParameters( mix )
{
   var bins=65536, h=new Uint32Array(bins);
   for (var c=0;c<3;++c)
   {
      var hc=fineHistogramOfArray(mix.out[c],bins);
      for(var b=0;b<bins;++b) h[b]+=hc[b];
   }
   var median=percentileFromHistogram(h,50);
   var dh=new Uint32Array(bins);
   for(var c=0;c<3;++c)
      for(var i=0;i<mix.out[c].length;++i)
      {
         var v=mix.out[c][i];
         if(!isFinite(v)) continue;
         ++dh[Math.round(Math.abs(clamp01(v)-median)*(bins-1))];
      }
   return stfFromStatistics(median,percentileFromHistogram(dh,50));
}

function unlinkedSTFParameters( mix )
{
   var result=[], bins=65536;
   for(var c=0;c<3;++c)
   {
      var median=percentileFromHistogram(fineHistogramOfArray(mix.out[c],bins),50);
      result[c]=stfFromStatistics(median,madFromArray(mix.out[c],median,bins));
   }
   return result;
}

function displaySTFParameters( mix )
{
   if(P.mode!=0 || P.linearDisplayMode==2) return null;
   if(P.linearDisplayMode==1) return unlinkedSTFParameters(mix);
   var common=linkedSTFParameters(mix);
   return [common,common,common];
}

function applySTF( v, stf )
{
   return mtf(stf.m,clamp01((v-stf.c0)/Math.max(1e-8,1-stf.c0)));
}

function previewBitmap( cache, mix )
{
   var image = new Image( cache.ww, cache.wh, 3, ColorSpace.RGB, 32, PixelSampleType.Float );
   try
   {
      var stf = displaySTFParameters( mix );
      var rect = new Rect( 0, 0, cache.ww, cache.wh );
      for ( var channel = 0; channel < 3; ++channel )
      {
         var samples = new Float32Array( cache.ww*cache.wh );
         for ( var i = 0; i < samples.length; ++i )
         {
            var value = mix.out[channel][i];
            if ( !isFinite(value) )
               throw new Error( tr( "Le preview contient une valeur non valide. Vérifier les sources.", "The preview contains a non-finite value. Check the sources." ) );
            samples[i] = stf != null ? applySTF(value,stf[channel]) : clamp01(value);
         }
         image.setSamples( samples, rect, channel );
      }
      return image.render();
   }
   finally
   {
      image.free();
   }
}

// Prepare sparse terms once and read only sources that actually contribute.
function makeMixPlan( matrix )
{
   var plan = { indices: [[],[],[]], weights: [[],[],[]], used: [false,false,false,false,false,false] };
   for ( var channel = 0; channel < 3; ++channel )
      for ( var source = 0; source < 6; ++source )
         if ( matrix[channel][source] != 0 )
         {
            plan.indices[channel].push(source);
            plan.weights[channel].push(matrix[channel][source]);
            plan.used[source] = true;
         }
   return plan;
}

function readMixBlock( sources, plan, rect, count )
{
   var buffers = new Array(6);
   for ( var source = 0; source < 6; ++source )
      if ( plan.used[source] )
      {
         buffers[source] = new Float64Array(count);
         if ( sources.views[source] != null )
            sources.views[source].image.getSamples(buffers[source],rect,sources.channels[source]);
      }
   return buffers;
}

function mixedSample( buffers, plan, channel, index )
{
   var value = 0, indices = plan.indices[channel], weights = plan.weights[channel];
   for ( var i = 0; i < indices.length; ++i ) value += weights[i]*buffers[indices[i]][index];
   return value;
}

function normalizationForExport( minimum, maximum )
{
   if ( !isFinite(minimum) || !isFinite(maximum) || minimum > maximum )
      throw new Error( tr( "La sortie contient des valeurs non valides.", "The output contains non-finite values." ) );
   var addition = 0, scale = 1;
   // One common RGB transform preserves all samples without hard clipping.
   // Samples already in [0,1] are left unchanged.
   if ( minimum < 0 ) addition = -minimum + 0.0001;
   var shiftedMaximum = maximum + addition;
   if ( shiftedMaximum > 1 ) scale = 1/shiftedMaximum;
   if ( !isFinite(addition) || !isFinite(scale) || !(scale > 0) )
      throw new Error( tr( "La plage de sortie ne peut pas être normalisée.", "The output range cannot be normalized." ) );
   return { addition: addition, scale: scale, applied: addition != 0 || scale != 1 };
}

// Measure every mixed pixel with copied source blocks. No image is allocated.
function scanMixedRanges( sources, matrix, dialog )
{
   var plan = makeMixPlan(matrix), W = sources.width, H = sources.height;
   var result = { minima: [Infinity,Infinity,Infinity], maxima: [-Infinity,-Infinity,-Infinity] };
   for ( var y0 = 0; y0 < H; y0 += BLOCK_ROWS )
   {
      var y1 = Math.min(H,y0+BLOCK_ROWS), n = W*(y1-y0);
      var input = readMixBlock(sources,plan,new Rect(0,y0,W,y1),n);
      for ( var channel = 0; channel < 3; ++channel )
         for ( var i = 0; i < n; ++i )
         {
            var value = mixedSample(input,plan,channel,i);
            if ( !isFinite(value) )
               throw new Error(tr("Le mélange contient un pixel non valide. Vérifier les sources.","The mix contains a non-finite pixel. Check the sources."));
            if ( value < result.minima[channel] ) result.minima[channel] = value;
            if ( value > result.maxima[channel] ) result.maxima[channel] = value;
         }
      if ( dialog && y0 % (BLOCK_ROWS*8) == 0 )
      {
         dialog.statusLabel.text = format(tr("Vérification de la plage réelle : %.0f %%","Checking the full-resolution range: %.0f %%"),100*y1/H);
         CoreApplication.processEvents();
      }
   }
   return result;
}

function previewMixedRanges( cache, matrix, dialog )
{
   if ( !cache.minima || !cache.maxima )
      throw new Error(tr("Préparer/rafraîchir le preview pour mesurer les extrema des sources.","Prepare/refresh the preview to measure the source extrema."));
   var key = JSON.stringify(matrix);
   if ( !cache.rangeCache ) cache.rangeCache = [];
   for ( var i = 0; i < cache.rangeCache.length; ++i )
      if ( cache.rangeCache[i].key == key ) return cache.rangeCache[i].range;
   var range = { minima: [0,0,0], maxima: [0,0,0] }, needsScan = false;
   for ( var channel = 0; channel < 3; ++channel )
   {
      var count = 0;
      for ( var source = 0; source < 6; ++source )
         if ( matrix[channel][source] != 0 )
         {
            ++count;
            var a = matrix[channel][source]*cache.minima[source];
            var b = matrix[channel][source]*cache.maxima[source];
            range.minima[channel] = Math.min(a,b);
            range.maxima[channel] = Math.max(a,b);
         }
      if ( count > 1 ) needsScan = true;
   }
   if ( needsScan )
   {
      // Blended sources can peak at different pixels: summing their individual
      // maxima would give an incorrect scale. Scan the actual weighted mixture.
      var sources = collectSources(matrix,false);
      if ( cache.key != cacheKey(sources,PREVIEW_SIZES[P.previewSizeIndex]) )
         throw new Error(tr("Les sources ont changé. Préparer/rafraîchir le preview.","Sources have changed. Prepare/refresh the preview."));
      var wasEnabled = dialog ? dialog.enabled : false;
      if ( dialog )
      {
         dialog.checkingPreviewRange = true;
         dialog.timer.stop();
         dialog.enabled = false;
      }
      try { range = scanMixedRanges(sources,matrix,dialog); }
      finally
      {
         if ( dialog )
         {
            dialog.enabled = wasEnabled;
            dialog.checkingPreviewRange = false;
         }
      }
   }
   cache.rangeCache.unshift({key:key,range:range});
   if ( cache.rangeCache.length > 8 ) cache.rangeCache.pop();
   return range;
}

function rangeAfterAdjustments( range, shifts, offsets )
{
   var minimum = Infinity, maximum = -Infinity;
   for ( var channel = 0; channel < 3; ++channel )
   {
      minimum = Math.min(minimum,range.minima[channel]+shifts[channel]+offsets[channel]);
      maximum = Math.max(maximum,range.maxima[channel]+shifts[channel]+offsets[channel]);
   }
   return { minimum: minimum, maximum: maximum };
}

function normalizedOutputSample( value, transform, reducedPreview )
{
   var stored = Math.fround((value+transform.addition)*transform.scale);
   // Source block means are stored as Float32. Their final rounding can cross
   // an endpoint by a few ulps; only that preview rounding is absorbed here.
   if ( reducedPreview && isFinite(stored) && stored >= -1e-6 && stored <= 1+1e-6 )
      stored = clamp01(stored);
   if ( !isFinite(value) || !isFinite(stored) || stored < 0 || stored > 1 )
      throw new Error(tr("Création annulée : une valeur de sortie ne peut pas être affichée en sécurité.","Creation cancelled: an output sample cannot be displayed safely."));
   return stored;
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
   this.hist = zeroHist4();
   this.mode = P.histMode;
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
         var lm = 30, rm = 8, tm = 8, bm = 24;
         var w = Math.max( 1, this.width - lm - rm );
         var h = Math.max( 1, this.height - tm - bm );
         g.pen = new Pen( 0xff6b6b6b, 1 );
         g.drawLine( lm, tm, lm, tm + h );
         g.drawLine( lm, tm + h, lm + w, tm + h );

         var channels = self.mode == 0 ? [0,1,2] : [ self.mode == 4 ? 3 : self.mode - 1 ];
         var colors = [ 0xffff5555, 0xff55dd77, 0xff5599ff, 0xffdddddd ];
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
            g.pen = new Pen( colors[c], 1 );
            var px = lm, py = tm + h;
            for ( var i = 0; i < columns; ++i )
            {
               var xx = lm + Math.round( i*( w - 1 )/( columns - 1 ) );
               var yy = tm + h - Math.round( histogramCountForScale( hh[i], self.scale )*h/maxY );
               if ( i > 0 ) g.drawLine( px, py, xx, yy );
               px = xx; py = yy;
            }
         }

         var leftLabel = self.zoom == 1 ? "0" : start.toFixed( 4 );
         var middleLabel = self.zoom == 1 ? "0.5" : ( start + 0.5/self.zoom ).toFixed( 4 );
         var rightLabel = self.zoom == 1 ? "1" : end.toFixed( 4 );
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

setData( h )
{
   this.hist = h;
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

function fullRender( dialog )
{
   var matrix = matrixForCalculation(), offsets = effectiveOffsets();
   var sources = collectSources(matrix,false), plan = makeMixPlan(matrix);
   var correction = { shifts: [0,0,0] };
   if ( P.backgroundNormalization )
      correction = estimateMixedFootCorrection(buildPreviewCache(dialog,false),matrix);
   var W = sources.width, H = sources.height, total = W*H;
   // Always validate the current sources again at export, even if the preview
   // already measured this matrix. Changes cannot bypass output validation.
   var range = rangeAfterAdjustments(scanMixedRanges(sources,matrix,dialog),correction.shifts,offsets);
   var minimum = range.minimum, maximum = range.maximum;
   var transform = normalizationForExport(minimum,maximum);
   console.writeln(format(tr("Sortie brute : min %.8f | max %.8f","Raw output: min %.8f | max %.8f"),minimum,maximum));
   if ( transform.applied )
      console.writeln(format(tr("Normalisation commune RGB sans écrêtage : ajout %.8f | facteur %.8f","Common RGB normalization without clipping: addition %.8f | scale %.8f"),transform.addition,transform.scale));

   var id = validId("SHORGB_AIP_Mix");
   var window = new ImageWindow(W,H,3,32,true,true,id);
   if ( window == null || window.isNull )
      throw new Error(tr("Impossible de créer l'image de sortie.","Cannot create the output image."));
   var view = window.mainView, image = view.image, completed = false;
   var hist = zeroHist4();
   view.beginProcess(UndoFlag.NoSwapFile);
   try
   {
      for ( var y0 = 0; y0 < H; y0 += BLOCK_ROWS )
      {
         var y1 = Math.min(H,y0+BLOCK_ROWS), rect = new Rect(0,y0,W,y1), n = W*(y1-y0);
         var input = readMixBlock(sources,plan,rect,n);
         var output = [new Float32Array(n),new Float32Array(n),new Float32Array(n)];
         for ( var channel = 0; channel < 3; ++channel )
            for ( var i = 0; i < n; ++i )
            {
               var value = mixedSample(input,plan,channel,i) + correction.shifts[channel] + offsets[channel];
               var stored = normalizedOutputSample(value,transform,false);
               output[channel][i] = stored;
               ++hist[channel][Math.round(stored*(HIST_BINS-1))];
            }
         for ( var i = 0; i < n; ++i )
         {
            var luminance = 0.2126*output[0][i] + 0.7152*output[1][i] + 0.0722*output[2][i];
            ++hist[3][Math.round(clamp01(luminance)*(HIST_BINS-1))];
         }
         for ( var channel = 0; channel < 3; ++channel ) image.setSamples(output[channel],rect,channel);
         if ( y0 % (BLOCK_ROWS*8) == 0 )
         {
            dialog.statusLabel.text = format(tr("Création image finale : %.0f %%","Rendering final image: %.0f %%"),100*y1/H);
            CoreApplication.processEvents();
         }
      }
      image.resetSelections();
      completed = true;
   }
   finally
   {
      view.endProcess();
      if ( !completed ) window.forceClose();
   }
   dialog.histControl.setData(hist);
   dialog.setClipLabel([0,0,0],[0,0,0],total,
                      transform.applied?tr("Image finale normalisée","Normalized final image"):tr("Image finale","Final image"),transform);
   dialog.statusLabel.text = transform.applied ?
      format(tr("Image finale créée — normalisation commune ×%.6f","Final image created — common normalization ×%.6f"),transform.scale) :
      tr("Rendu terminé : ","Rendering complete: ")+id;
   window.show();
   window.zoomToFit();
   return window;
}

var MixerDialog = class extends Dialog {
constructor()
{
   super();
   var self = this;
   this.windowTitle = TITLE + " " + VERSION;
   this.updating = false;
   this.lastMix = null;
   this.relaunch = false;
   this.relaunchState = null;
   this.rendering = false;
   this.checkingPreviewRange = false;
   this.onClose = function() { return !self.rendering && !self.checkingPreviewRange; };
   this.compactSize = null;
   this.advancedExpanded = false;

   this.titleLabel = new Label( this );
   this.titleLabel.useRichText = true;
   this.titleLabel.text = "<b>SHORGB-AIP 1.02</b> — Philippe Bernhard — SII · Ha · OIII · R · G · B → RGB";

   this.languageLabel = new Label( this );
   this.languageLabel.text = "Langue / Language :";
   this.languageCombo = new ComboBox( this );
   this.languageCombo.addItem( "Français" );
   this.languageCombo.addItem( "English" );
   this.languageCombo.currentItem = P.language == "en" ? 1 : 0;
   this.languageCombo.toolTip = tr(
      "Change la langue en conservant les sources, les réglages et le preview. Le choix est mémorisé.",
      "Changes the language while keeping sources, settings and the preview. The choice is remembered." );
   this.languageCombo.onItemSelected = function( index )
   {
      var language = index == 1 ? "en" : "fr";
      if ( self.updating || self.checkingPreviewRange || language == P.language ) return;
      self.syncIds();
      self.timer.stop();
      self.relaunchState = self.captureInterfaceState();
      P.language = language;
      saveSettings();
      self.relaunch = true;
      self.ok();
   };
   var headerRow = new HorizontalSizer;
   headerRow.spacing = 8;
   headerRow.add( this.titleLabel );
   headerRow.addStretch();
   headerRow.add( this.languageLabel );
   headerRow.add( this.languageCombo );

   this.subtitleLabel = new Label( this );
   this.subtitleLabel.wordWrapping = true;
   this.subtitleLabel.text = tr(
      "18 coefficients indépendants. Le preview réduit sert au réglage interactif ; l'image finale est calculée depuis les sources originales. " +
      "Le preview et l'histogramme DATA simulent la normalisation commune de sortie, avant STF. Les offsets manuels et la qualité du preview sont accessibles dans les réglages avancés.",
      "18 independent coefficients. The reduced preview is used for interactive adjustments; the final image is rendered from the original sources. " +
      "The preview and DATA histogram simulate common output normalization, before STF. Manual offsets and preview quality are available in the advanced settings." );

   // Sources -----------------------------------------------------------------
   this.sourcesGroup = new GroupBox( this );
   this.sourcesGroup.title = "Sources";
   this.sourceLists = [];
   var ss = new VerticalSizer;
   ss.margin = 6;
   ss.spacing = 4;

   for ( let s = 0; s < 6; ++s )
   {
      let row = new HorizontalSizer;
      row.spacing = 5;
      let lab = new Label( this.sourcesGroup );
      lab.text = SOURCE_NAMES[s] + " :";
      lab.minWidth = this.font.width( "OIII :" ) + 8;
      lab.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      let list = new ViewList( this.sourcesGroup );
      list.getMainViews();
      let v = findView( P.ids[s] );
      if ( v != null ) list.currentView = v;
      list.onViewSelected = function( view )
      {
         P.ids[s] = ( view == null || view.isNull ) ? "" : view.id;
         CACHE = null;
         self.statusLabel.text = tr( "<b><font color=\"#cc2020\">Sources modifiées : préparer/rafraîchir le preview.</font></b>", "<b><font color=\"#cc2020\">Sources changed: prepare/refresh the preview.</font></b>" );
      };
      this.sourceLists.push( list );
      row.add( lab );
      row.add( list, 100 );
      ss.add( row );
   }
   this.sourcesGroup.sizer = ss;

   // Options -----------------------------------------------------------------
   this.optionsGroup = new GroupBox( this );
   this.optionsGroup.title = "Options";

   this.advancedCheck = new CheckBox( this.optionsGroup );
   this.advancedCheck.text = tr( "Réglages avancés", "Advanced settings" );
   this.advancedCheck.checked = P.showAdvanced;
   this.advancedCheck.toolTip = tr(
      "Afficher ou masquer les offsets RGB et la qualité du preview. Les valeurs restent appliquées lorsque le panneau est replié.",
      "Show or hide RGB offsets and preview quality. Values remain applied when the panel is collapsed." );
   this.advancedGroup = new GroupBox( this.optionsGroup );
   this.advancedGroup.title = tr( "Offsets et qualité", "Offsets and quality" );
   this.advancedCheck.onCheck = function( value )
   {
      if ( self.updating ) return;
      P.showAdvanced = !!value;
      self.updateAdvancedVisibility();
   };


   this.modeCombo = new ComboBox( this.optionsGroup );
   this.modeCombo.addItem( tr( "Linéaire", "Linear" ) );
   this.modeCombo.addItem( tr( "Non-linéaire", "Nonlinear" ) );
   this.modeCombo.currentItem = P.mode;
   this.modeCombo.onItemSelected = function( idx )
   {
      P.mode = idx;
      self.updateDisplayControls();
      self.schedulePreview();
   };

   // Positive histogram-foot alignment --------------------------------------
   this.backgroundCheck = new CheckBox( this.optionsGroup );
   this.backgroundCheck.text = tr( "Aligner le pied des histogrammes", "Align histogram feet" );
   this.backgroundCheck.checked = P.backgroundNormalization;
   this.backgroundCheck.toolTip =
      tr( "<p>Décale chaque canal pour placer son pied près d'une valeur positive.</p>", "<p>Shifts each channel to place its histogram foot near a positive value.</p>" ) +
      tr( "<p>Le percentile 0,1 % repère le pied ; les minima réels des sources protègent ", "<p>The 0.1st percentile locates the foot; the true source minima protect " ) +
      tr( "contre les valeurs négatives créées par ce décalage.</p>", "against negative values created by this shift.</p>" ) +
      tr( "<p>Translation seule : aucun maximum utilisé, aucun étirement vers 1. ", "<p>Additive shift only: no maximum is used and there is no scaling to 1. " ) +
      tr( "Les offsets manuels sont ajoutés ensuite.</p>", "Manual offsets are added afterwards.</p>" );
   this.backgroundCheck.onCheck = function( v )
   {
      P.backgroundNormalization = v;
      self.floorTargetControl.enabled = v;
      self.schedulePreview();
   };
   this.floorTargetControl = new NumericControl( this.optionsGroup );
   this.floorTargetControl.label.text = tr( "Pied cible :", "Foot target:" );
   this.floorTargetControl.label.minWidth = this.font.width( tr( "Offset R grossier :", "R coarse offset:" ) ) + 8;
   this.floorTargetControl.setReal( true );
   this.floorTargetControl.setRange( 0, 0.5 );
   this.floorTargetControl.setPrecision( 4 );
   this.floorTargetControl.enableFixedPrecision( true );
   // Explicit mapping preserves the 0.0001 step with 5000 slider intervals.
   this.floorTargetControl.sliderValueToControl = function( tick )
   {
      return Math.round( clamp( tick, 0, 5000 ) )/10000;
   };
   this.floorTargetControl.controlValueToSlider = function( value )
   {
      return clamp( Math.round( value*10000 ), this.slider.minValue, this.slider.maxValue );
   };
   this.floorTargetControl.slider.setRange( 0, 5000 );
   this.floorTargetControl.slider.stepSize = 1;
   this.floorTargetControl.slider.pageSize = 1;
   this.floorTargetControl.setValue( P.histFloorTarget );
   this.floorTargetControl.enabled = P.backgroundNormalization;
   this.floorTargetControl.toolTip =
      tr( "<p>Pied robuste souhaité de 0,0000 à 0,5000, avant les offsets manuels. Défaut : 0,0050.</p>", "<p>Desired robust histogram foot from 0.0000 to 0.5000, before manual offsets. Default: 0.0050.</p>" ) +
      tr( "<p>Le curseur actualise le preview pendant le réglage, après sa préparation. ", "<p>The slider updates the preview while adjusting, once it has been prepared. " ) +
      tr( "Les boutons − et + règlent la cible de 0,0001 par clic. ", "The − and + buttons adjust the target by 0.0001 per click. " ) +
      tr( "Valider une saisie au clavier avec Entrée.</p>", "Press Enter to confirm a typed value.</p>" ) +
      tr( "<p>La protection contre l'écrêtage reste active, y compris avec une cible à zéro. ", "<p>Protection against low-end clipping remains active, including with a zero target. " ) +
      tr( "Si des pixels plus bas l'exigent, le canal est davantage relevé pour rester positif.</p>", "If lower pixels require it, the channel is lifted further to stay positive.</p>" );
   this.floorTargetControl.onValueUpdated = function( value )
   {
      if ( self.updating ) return;
      P.histFloorTarget = Math.round( clamp( safeNumber( value, P.histFloorTarget ), 0, 0.5 )*10000 )/10000;
      self.schedulePreview( true );
   };
   this.floorTargetControl.stepTarget = function( direction )
   {
      this.evaluate();
      var tick = clamp( this.controlValueToSlider( this.value ) + ( direction < 0 ? -1 : 1 ),
                        this.slider.minValue, this.slider.maxValue );
      var value = this.sliderValueToControl( tick );
      if ( value != this.value )
      {
         this.setValue( value );
         this.onValueUpdated( value );
      }
   };
   for ( let direction of [ -1, 1 ] )
   {
      let button = new ToolButton( this.floorTargetControl );
      button.text = direction < 0 ? "−" : "+";
      button.setScaledFixedSize( 22, 22 );
      button.toolTip = ( direction < 0 ? tr( "Diminuer", "Decrease" ) : tr( "Augmenter", "Increase" ) ) + tr( " le pied cible de 0,0001 par clic.", " the foot target by 0.0001 per click." );
      button.onClick = function() { self.floorTargetControl.stepTarget( direction ); };
      this.floorTargetControl.sizer.add( button );
      if ( direction < 0 ) this.floorTargetControl.decreaseButton = button;
      else this.floorTargetControl.increaseButton = button;
   }

   this.offsetCoarseControls = [];
   this.offsetFineControls = [];
   for ( let c = 0; c < 3; ++c )
      for ( let tier = 0; tier < 2; ++tier )
      {
         let isFine = ( tier == 1 );
         let control = new NumericControl( this.advancedGroup );
         control.label.text = "Offset " + OUTPUT_NAMES[c] + ( isFine ? tr( " fin :", " fine:" ) : tr( " grossier :", " coarse:" ) );
         control.label.minWidth = this.font.width( tr( "Offset R grossier :", "R coarse offset:" ) ) + 8;
         control.setReal( true );
         control.setRange( isFine ? -0.02 : -0.2, isFine ? 0.02 : 0.2 );
         control.setPrecision( isFine ? 4 : 3 );
         control.enableFixedPrecision( true );
         // PJSR's default mapping rounds to floor(log10(slider span)) decimals.
         // With 400 intervals this is only 2 decimals, regardless of setPrecision().
         // Use nonnegative ticks [0,400], with zero centered at tick 200.
         // Tick 0 = negative limit; tick 400 = positive limit.
         control.sliderValueToControl = function( tick )
         {
            return roundedOffset( ( tick - 200 )*( isFine ? 0.0001 : 0.001 ),
                                  isFine ? 0.02 : 0.2, isFine ? 4 : 3 );
         };
         control.controlValueToSlider = function( value )
         {
            return clamp( 200 + Math.round( value/( isFine ? 0.0001 : 0.001 ) ),
                          this.slider.minValue, this.slider.maxValue );
         };
         control.slider.setRange( 0, 400 );
         control.slider.stepSize = 1;
         control.slider.pageSize = 1; // A click beside the handle moves one tick, not five.
         control.setValue( isFine ? P.offsetsFine[c] : P.offsetsCoarse[c] );
         control.toolTip =
            tr( "<p>Canal ", "<p>Channel " ) + OUTPUT_NAMES[c] + tr( " : offset total = grossier + fin.</p>", ": total offset = coarse + fine.</p>" ) +
            ( isFine ? tr( "<p>Fin : −0,0200 à +0,0200 ; pas 0,0001.</p>", "<p>Fine: −0.0200 to +0.0200; step 0.0001.</p>" ) :
                       tr( "<p>Grossier : −0,200 à +0,200 ; pas 0,001.</p>", "<p>Coarse: −0.200 to +0.200; step 0.001.</p>" ) ) +
            tr( "<p>Ajouté après le mixage et l’alignement facultatif du pied, ", "<p>Added after mixing and optional histogram-foot alignment, " ) +
            tr( "dans le preview, l'histogramme DATA et l'image finale.</p>", "in the preview, DATA histogram and final image.</p>" );
         control.onValueUpdated = function( v )
         {
            if ( self.updating ) return;
            if ( isFine ) P.offsetsFine[c] = roundedOffset( v, 0.02, 4 );
            else P.offsetsCoarse[c] = roundedOffset( v, 0.2, 3 );
            self.schedulePreview();
         };
         // Exact mouse adjustment, independent of slider width or drag speed.
         control.stepOffset = function( direction )
         {
            this.evaluate(); // Commit any value typed before the button click.
            var tick = clamp( this.controlValueToSlider( this.value ) + ( direction < 0 ? -1 : 1 ),
                              this.slider.minValue, this.slider.maxValue );
            var value = this.sliderValueToControl( tick );
            if ( value != this.value )
            {
               this.setValue( value );
               if ( this.onValueUpdated ) this.onValueUpdated( value );
            }
         };
         for ( let direction of [ -1, 1 ] )
         {
            let button = new ToolButton( control );
            button.text = direction < 0 ? "−" : "+";
            button.setScaledFixedSize( 22, 22 );
            button.toolTip = ( direction < 0 ? tr( "Diminuer", "Decrease" ) : tr( "Augmenter", "Increase" ) ) +
               tr( " l'offset ", " the offset " ) + OUTPUT_NAMES[c] + ( isFine ? tr( " fin de 0,0001", " fine by 0.0001" ) : tr( " grossier de 0,001", " coarse by 0.001" ) ) +
               tr( " par clic.", " per click." );
            button.onClick = function() { control.stepOffset( direction ); };
            control.sizer.add( button );
            if ( direction < 0 ) control.decreaseButton = button;
            else control.increaseButton = button;
         }
         control.slider.toolTip =
            tr( "Glisser pour un déplacement rapide ; cliquer à côté du curseur pour un cran. ", "Drag for a quick adjustment; click beside the handle to move one step. " ) +
            tr( "Les boutons − et + donnent un pas exact par clic.", "The − and + buttons give one exact step per click." );
         if ( isFine ) this.offsetFineControls[c] = control;
         else this.offsetCoarseControls[c] = control;
      }

   this.displayLabel = new Label(this.optionsGroup);
   this.displayLabel.text = P.mode == 0 ? tr( "Affichage linéaire :", "Linear display:" ) : tr( "Affichage : Direct", "Display: Direct" );
   this.linearDisplayCombo = new ComboBox(this.optionsGroup);
   ["Linked STF", "Unlinked STF", tr( "Linéaire (brut)", "Linear (raw)" )].forEach(function(label) { self.linearDisplayCombo.addItem(label); });
   this.linearDisplayCombo.currentItem = P.linearDisplayMode;
   this.linearDisplayCombo.enabled = (P.mode == 0);
   this.linearDisplayCombo.toolTip =
      tr( "<p>Linked STF : médiane/MAD/MTF communs RGB. Unlinked STF : calcul séparé R/G/B. ", "<p>Linked STF: pooled RGB median/MAD/MTF. Unlinked STF: separate R/G/B calculations. " ) +
      tr( "Linear : données brutes. Histogramme DATA avant STF.</p>", "Linear: raw data. DATA histogram before STF.</p>" ) +
      tr( "<p><b>Attention : Unlinked STF modifie l'équilibre apparent des couleurs dans l'aperçu. ", "<p><b>Warning: Unlinked STF changes the apparent colour balance in the preview. " ) +
      tr( "Cet étirement n'est pas appliqué à l'image finale.</b></p>", "This stretch is not applied to the final image.</b></p>" );
   this.linearDisplayCombo.onItemSelected = function( idx )
   {
      P.linearDisplayMode = idx;
      self.updateDisplayControls();
      self.schedulePreview();
   };
   var displayRow = new HorizontalSizer;
   displayRow.spacing = 5;
   displayRow.add(this.displayLabel);
   displayRow.add(this.linearDisplayCombo);
   displayRow.addStretch();

   this.stfLevelLabel = new Label( this.optionsGroup );
   this.stfLevelLabel.text = tr( "Niveau STF :", "STF level:" );
   this.stfLevelCombo = new ComboBox( this.optionsGroup );
   [ "Low", "Medium", "High" ].forEach( function( label ) { self.stfLevelCombo.addItem( label ); } );
   this.stfLevelCombo.currentItem = P.stfLevel;
   this.stfLevelCombo.toolTip =
      tr( "<p>Intensité de l'étirement du preview : Low = doux, Medium = niveau habituel, High = plus lumineux.</p>", "<p>Preview stretch intensity: Low = gentle, Medium = the usual level, High = brighter.</p>" ) +
      tr( "<p>La luminosité cible de la médiane vaut 0,15 / 0,25 / 0,35. ", "<p>The median brightness targets are 0.15 / 0.25 / 0.35. " ) +
      tr( "Le calcul de la médiane, du MAD et du point noir reste identique.</p>", "The median, MAD and black-point calculations stay the same.</p>" ) +
      tr( "<p>Actif en Linked STF et Unlinked STF. Modifie uniquement l'affichage du preview ; ", "<p>Available in Linked STF and Unlinked STF. Changes only the preview display; " ) +
      tr( "le mixage, l'histogramme DATA et l'image finale sont conservés.</p>", "mixing, the DATA histogram and the final image are preserved.</p>" );
   this.stfLevelCombo.onItemSelected = function( idx )
   {
      if ( self.updating ) return;
      P.stfLevel = clamp( idx, 0, STF_TARGETS.length - 1 );
      self.schedulePreview();
   };
   var stfLevelRow = new HorizontalSizer;
   stfLevelRow.spacing = 5;
   stfLevelRow.add( this.stfLevelLabel );
   stfLevelRow.add( this.stfLevelCombo );
   stfLevelRow.addStretch();

   this.previewSizeCombo = new ComboBox( this.advancedGroup );
   for ( var i = 0; i < PREVIEW_SIZES.length; ++i )
      this.previewSizeCombo.addItem( PREVIEW_SIZES[i] + " px" );
   this.previewSizeCombo.currentItem = P.previewSizeIndex;
   this.previewSizeCombo.onItemSelected = function( idx )
   {
      P.previewSizeIndex = idx;
      CACHE = null;
      self.statusLabel.text = tr( "<b><font color=\"#cc2020\">Qualité modifiée : préparer/rafraîchir le preview.</font></b>", "<b><font color=\"#cc2020\">Quality changed: prepare/refresh the preview.</font></b>" );
   };

   var os = new VerticalSizer;
   os.margin = 6;
   os.spacing = 5;
   var modeRow = new HorizontalSizer;
   modeRow.spacing = 5;
   var modeLab = new Label( this.optionsGroup ); modeLab.text = tr( "Données :", "Data:" );
   modeRow.add( modeLab ); modeRow.add( this.modeCombo ); modeRow.addStretch();
   var qRow = new HorizontalSizer;
   qRow.spacing = 5;
   var qLab = new Label( this.advancedGroup ); qLab.text = tr( "Preview :", "Preview:" );
   qRow.add( qLab ); qRow.add( this.previewSizeCombo ); qRow.addStretch();
   os.add( modeRow );
   os.add( this.backgroundCheck );
   os.add( this.floorTargetControl );
   os.add( displayRow );
   os.add( stfLevelRow );
   os.add( this.advancedCheck );
   var advancedSizer = new VerticalSizer;
   advancedSizer.margin = 6;
   advancedSizer.spacing = 5;
   for ( var c = 0; c < 3; ++c )
   {
      advancedSizer.add( this.offsetCoarseControls[c] );
      advancedSizer.add( this.offsetFineControls[c] );
   }
   advancedSizer.add( qRow );
   this.advancedGroup.sizer = advancedSizer;
   os.add( this.advancedGroup );
   this.optionsGroup.sizer = os;

   // Histogram ---------------------------------------------------------------
   this.histGroup = new GroupBox( this );
   this.histGroup.title = tr( "Histogramme DATA de sortie", "Output DATA histogram" );
   this.histGroup.toolTip = tr(
      "<p>Données après le mixage, le pied, les offsets et la normalisation commune de sortie ; avant tout STF.</p><p>Le preview utilise la même plage en pleine résolution que l'export. Les courbes restent une estimation issue des pixels moyennés du preview ; après la création, l'histogramme compte tous les pixels de l'image finale.</p>",
      "<p>Data after mixing, foot alignment, offsets and common output normalization; before any STF.</p><p>The preview uses the same full-resolution range as export. Curves remain an estimate from averaged preview pixels; after creation, the histogram counts every final-image pixel.</p>" );
   this.histControl = new HistogramControl( this.histGroup );
   this.histModeCombo = new ComboBox( this.histGroup );
   [ "RGB", "R", "G", "B", "L" ].forEach( function( x ) { self.histModeCombo.addItem( x ); } );
   this.histModeCombo.currentItem = P.histMode;
   this.histModeCombo.onItemSelected = function( idx )
   {
      P.histMode = idx;
      self.histControl.setMode( idx );
   };
   this.histScaleCombo = new ComboBox( this.histGroup );
   [ tr( "Linéaire", "Linear" ), tr( "Logarithmique", "Logarithmic" ), tr( "Racine carrée (√)", "Square root (√)" ), tr( "Carrée (x²)", "Square (x²)" ) ].forEach( function( label )
   {
      self.histScaleCombo.addItem( label );
   } );
   this.histScaleCombo.currentItem = P.histScale;
   this.histScaleCombo.toolTip =
      tr( "<p>Échelle verticale des effectifs : linéaire, logarithme, racine carrée ou carré.</p>", "<p>Vertical count scale: linear, logarithmic, square root or square.</p>" ) +
      tr( "<p>Modifie seulement la hauteur des courbes. Les données, l'axe horizontal, ", "<p>Only changes the height of the curves. The data, horizontal axis, " ) +
      tr( "le clipping et le STF ne sont pas modifiés.</p>", "clipping and STF are unchanged.</p>" );
   this.histScaleCombo.onItemSelected = function( idx )
   {
      P.histScale = idx;
      self.histControl.setScale( idx );
   };
   this.histZoomCombo = new ComboBox( this.histGroup );
   HIST_ZOOMS.forEach( function( zoom ) { self.histZoomCombo.addItem( "×" + zoom ); } );
   this.histZoomCombo.toolTip =
      tr( "<p>Zoom horizontal du DATA : ×10 affiche une largeur de 0,1.</p>", "<p>Horizontal DATA zoom: ×10 displays a width of 0.1.</p>" ) +
      tr( "<p>Utilisez Début pour déplacer la fenêtre. Indépendant de l'échelle verticale et du STF.</p>", "<p>Use Start to move the visible interval. Independent of the vertical scale and STF.</p>" );
   this.histStartControl = new NumericEdit( this.histGroup );
   this.histStartControl.label.text = tr( "Début :", "Start:" );
   this.histStartControl.setReal( true );
   this.histStartControl.setPrecision( 4 );
   this.histStartControl.enableFixedPrecision( true );
   this.histStartControl.toolTip = tr( "Borne gauche de la fenêtre du DATA. Par exemple : 0,0200 à ×10 affiche 0,0200 → 0,1200.", "Left edge of the DATA interval. Example: 0.0200 at ×10 displays 0.0200 → 0.1200." );
   this.histZoomCombo.onItemSelected = function( idx )
   {
      self.updateHistogramViewport( idx, P.histStart );
   };
   this.histStartControl.onValueUpdated = function( value )
   {
      self.updateHistogramViewport( P.histZoomIndex, value );
   };
   this.updateHistogramViewport( P.histZoomIndex, P.histStart );
   this.clipLabel = new Label( this.histGroup );
   this.clipLabel.wordWrapping = true;
   this.clipLabel.text = tr( "Sortie : aucun preview calculé.", "Output: no preview calculated." );
   var hs = new VerticalSizer;
   hs.margin = 6;
   hs.spacing = 4;
   var hm = new HorizontalSizer;
   hm.spacing = 5;
   hm.add( new Label( this.histGroup ) );
   hm.addStretch();
   var hml = new Label( this.histGroup ); hml.text = tr( "Canal :", "Channel:" );
   hm.add( hml ); hm.add( this.histModeCombo );
   hs.add( hm );
   var scaleRow = new HorizontalSizer;
   scaleRow.spacing = 5;
   var scaleLabel = new Label( this.histGroup );
   scaleLabel.text = tr( "Échelle verticale :", "Vertical scale:" );
   scaleRow.add( scaleLabel );
   scaleRow.add( this.histScaleCombo );
   scaleRow.addStretch();
   hs.add( scaleRow );
   var zoomRow = new HorizontalSizer;
   zoomRow.spacing = 5;
   var zoomLabel = new Label( this.histGroup );
   zoomLabel.text = tr( "Zoom horizontal :", "Horizontal zoom:" );
   zoomRow.add( zoomLabel );
   zoomRow.add( this.histZoomCombo );
   zoomRow.addSpacing( 8 );
   zoomRow.add( this.histStartControl );
   zoomRow.addStretch();
   hs.add( zoomRow );
   hs.add( this.histControl, 100 );
   hs.add( this.clipLabel );
   this.histGroup.sizer = hs;

   // Matrix ------------------------------------------------------------------
   this.matrixGroup = new GroupBox( this );
   this.matrixGroup.title = tr( "Matrice 6 → 3", "6 → 3 matrix" );
   this.weightControls = [ [], [], [] ];
   this.sumLabels = [];
   var ms = new HorizontalSizer;
   ms.margin = 6;
   ms.spacing = 6;

   for ( let o = 0; o < 3; ++o )
   {
      let box = new GroupBox( this.matrixGroup );
      box.title = OUTPUT_NAMES[o] + tr( " final", " output" );
      let vs = new VerticalSizer;
      vs.margin = 5;
      vs.spacing = 2;
      for ( let s = 0; s < 6; ++s )
      {
         let nc = new NumericControl( box );
         nc.label.text = SOURCE_NAMES[s];
         nc.label.minWidth = this.font.width( "OIII" ) + 8;
         nc.setReal( true );
         nc.setRange( 0.0, 3.0 );
         nc.setPrecision( 3 );
         nc.enableFixedPrecision( true );
         nc.sliderValueToControl = function( tick )
         {
            return clamp( Math.round(tick), 0, 3000 )/1000;
         };
         nc.controlValueToSlider = function( value )
         {
            return clamp( Math.round(value*1000), 0, 3000 );
         };
         nc.slider.setRange( 0, 3000 );
         nc.slider.stepSize = 1;
         nc.slider.pageSize = 1;
         nc.setValue( P.weights[o][s] );
         nc.onValueUpdated = function( value )
         {
            if ( self.updating ) return;
            P.weights[o][s] = value;
            self.updateSums();
            self.updatePresetFromMatrix();
            self.schedulePreview();
         };
         // Integer thousandths keep every click exact, including after typing.
         nc.stepCoefficient = function( direction )
         {
            if ( self.updating || self.rendering || self.checkingPreviewRange ) return;
            this.evaluate();
            var tick = clamp( Math.round(this.value*1000) + (direction < 0 ? -1 : 1), 0, 3000 );
            var value = tick/1000;
            if ( value != this.value )
            {
               this.setValue( value );
               if ( this.onValueUpdated ) this.onValueUpdated( value );
            }
         };
         for ( let direction of [ -1, 1 ] )
         {
            let button = new ToolButton( nc );
            button.text = direction < 0 ? "−" : "+";
            button.setScaledFixedSize( 22, 22 );
            button.toolTip = (direction < 0 ? tr("Diminuer","Decrease") : tr("Augmenter","Increase")) +
               " " + SOURCE_NAMES[s] + " → " + OUTPUT_NAMES[o] +
               tr(" de 0,001 par clic (0 à 3,000)."," by 0.001 per click (0 to 3.000).");
            button.onClick = function() { nc.stepCoefficient(direction); };
            nc.sizer.add(button);
            if ( direction < 0 ) nc.decreaseButton = button;
            else nc.increaseButton = button;
         }
         nc.slider.toolTip = tr(
            "Glisser pour un réglage rapide ; les boutons − et + donnent un pas exact de 0,001 par clic.",
            "Drag for a quick adjustment; the − and + buttons give one exact 0.001 step per click." );
         this.weightControls[o][s] = nc;
         vs.add( nc );
      }
      let sl = new Label( box );
      sl.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      this.sumLabels[o] = sl;
      vs.add( sl );
      box.sizer = vs;
      ms.add( box, 100 );
   }
   this.matrixGroup.sizer = ms;

   // Presets -----------------------------------------------------------------
   this.presetCombo = new ComboBox( this );
   [ "SHO", "HOO", "RGB", "SHORGB 80/20", "HOORGB 80/20", tr( "Zéro", "Zero" ), tr( "Personnalisé", "Custom" ) ].forEach( function(x){ self.presetCombo.addItem(x); } );
   this.presetButton = new PushButton( this );
   this.presetButton.text = tr( "Charger preset", "Load preset" );
   this.presetButton.onClick = function() { self.applyPreset( self.presetCombo.currentItem ); };
   this.presetCombo.toolTip = tr(
      "Choisir un préréglage puis cliquer sur Charger preset. Personnalisé indique que la matrice ne correspond à aucun préréglage ; ses coefficients sont conservés.",
      "Choose a preset, then click Load preset. Custom means the matrix does not match a preset; its coefficients are preserved." );
   this.presetCombo.onItemSelected = function( index )
   {
      self.presetButton.enabled = index >= 0 && index < PRESET_CUSTOM;
   };


   this.autoSHOButton = new PushButton( this );
   this.autoSHOButton.text = "Auto SHO";
   this.autoSHOButton.setScaledFixedWidth( 78 );
   this.autoSHOButton.toolTip =
      tr( "<p>Crée une base SII→R, Ha→G, OIII→B en remplaçant la matrice actuelle.</p>", "<p>Creates an SII→R, Ha→G, OIII→B base, replacing the current matrix.</p>" ) +
      tr( "<p>Équilibre le signal entre le pied et le percentile 90, avec trois coefficients entre 0,2 et 2,5.</p>", "<p>Balances the signal between the histogram foot and the 90th percentile, with three coefficients between 0.2 and 2.5.</p>" ) +
      tr( "<p>Active le pied protégé à 0,0500, remet les offsets manuels à 0 ", "<p>Enables the protected foot at 0.0500, resets manual offsets to 0 " ) +
      tr( "et sélectionne Linked STF.</p>", "and selects Linked STF.</p>" );
   this.autoSHOButton.onClick = function()
   {
      self.timer.stop();
      self.syncIds();
      self.autoSHOButton.enabled = false;
      try
      {
         var sho = [ [1,0,0,0,0,0], [0,1,0,0,0,0], [0,0,1,0,0,0] ];
         var cache = buildPreviewCache( self, false, sho );
         var result = calculateAutoSHO( cache );
         // Apply only after all three sources have passed validation.
         P.backgroundNormalization = true;
         P.histFloorTarget = 0.05;
         P.offsetsCoarse = [ 0, 0, 0 ];
         P.offsetsFine = [ 0, 0, 0 ];
         P.linearDisplayMode = 0;
         self.setMatrix( result.weights, false );
         self.refreshControlsFromP();
         self.refreshPreview();
         self.statusLabel.text = format( tr( "Auto SHO : S %.3f · H %.3f · O %.3f — pied cible 0,0500", "Auto SHO: S %.3f · H %.3f · O %.3f — foot target 0.0500" ),
                                        result.coefficients[0], result.coefficients[1], result.coefficients[2] );
      }
      catch ( e )
      {
         self.statusLabel.text = tr( "<b><font color=\"#cc2020\">Auto SHO impossible : ", "<b><font color=\"#cc2020\">Auto SHO failed: " ) + errText( e ) + "</font></b>";
         showError( self, errText( e ) );
      }
      finally
      {
         self.autoSHOButton.enabled = true;
      }
   };

   // Preview -----------------------------------------------------------------
   this.previewBox = new PreviewBox( this );
   this.previewBox.setMinSize( this.logicalPixelsToPhysical( 700 ), this.logicalPixelsToPhysical( 430 ) );

   this.prepareButton = new PushButton( this );
   this.prepareButton.text = tr( "Préparer / Rafraîchir", "Prepare / Refresh" );
   this.prepareButton.onClick = function()
   {
      self.syncIds();
      try
      {
         buildPreviewCache( self, true );
         self.refreshPreview();
      }
      catch ( e )
      {
         showError( self, errText(e) );
         self.statusLabel.text = tr( "<b>Erreur de préparation.</b>", "<b>Preparation error.</b>" );
      }
   };

   this.fitButton = new PushButton( this );
   this.fitButton.text = tr( "Ajuster", "Fit" );
   this.fitButton.onClick = function() { self.previewBox.zoomFit(); };

   this.oneButton = new PushButton( this );
   this.oneButton.text = tr( "100 % preview", "100% preview" );
   this.oneButton.toolTip = tr( "1 pixel du preview réduit = 1 pixel écran.", "1 reduced-preview pixel = 1 screen pixel." );
   this.oneButton.onClick = function() { self.previewBox.zoomOne(); };

   this.statusLabel = new Label( this );
   this.statusLabel.useRichText = true;
   this.statusLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   this.statusLabel.text = tr( "<b><font color=\"#cc2020\">Sélectionner les sources puis préparer le preview.</font></b>", "<b><font color=\"#cc2020\">Select the sources, then prepare the preview.</font></b>" );

   this.unlinkedWarningLabel = new Label( this );
   this.unlinkedWarningLabel.useRichText = true;
   this.unlinkedWarningLabel.wordWrapping = true;
   this.unlinkedWarningLabel.text =
      tr( "<b><font color=\"#cc2020\">Attention — Unlinked STF : l'image finale n'aura pas le même aspect que cet aperçu.</font></b><br/>", "<b><font color=\"#cc2020\">Warning — Unlinked STF: the final image will not look like this preview.</font></b><br/>" ) +
      tr( "Ce mode étire R, G et B séparément pour l'affichage et modifie leur équilibre apparent. ", "This mode stretches R, G and B separately for display and changes their apparent balance. " ) +
      tr( "Cet étirement n'est pas appliqué à l'image finale.", "This stretch is not applied to the final image." );
   this.updateDisplayControls();

   var pr = new HorizontalSizer;
   pr.spacing = 5;
   pr.add( this.prepareButton ); pr.add( this.fitButton ); pr.add( this.oneButton );
   pr.addStretch(); pr.add( this.statusLabel );

   var presetRow = new HorizontalSizer;
   presetRow.spacing = 5;
   var pLab = new Label( this ); pLab.text = tr( "Preset :", "Preset:" );
   presetRow.add( pLab ); presetRow.add( this.presetCombo ); presetRow.add( this.presetButton );
   presetRow.add( this.autoSHOButton ); presetRow.addStretch();

   // Left / right columns ----------------------------------------------------
   this.leftColumn = new Control( this );
   var ls = new VerticalSizer;
   ls.spacing = 6;
   ls.add( this.sourcesGroup );
   ls.add( this.optionsGroup );
   ls.add( this.histGroup, 100 );
   ls.add( presetRow );
   this.leftColumn.sizer = ls;
   this.leftColumn.setMinWidth( this.logicalPixelsToPhysical( 430 ) );

   this.rightColumn = new Control( this );
   var rs = new VerticalSizer;
   rs.spacing = 6;
   rs.add( pr );
   rs.add( this.unlinkedWarningLabel );
   rs.add( this.previewBox, 100 );
   rs.add( this.matrixGroup );
   this.rightColumn.sizer = rs;

   var mainRow = new HorizontalSizer;
   mainRow.spacing = 8;
   mainRow.add( this.leftColumn );
   mainRow.add( this.rightColumn, 100 );

   // Bottom buttons ----------------------------------------------------------
   this.newInstanceButton = new ToolButton( this );
   this.newInstanceButton.icon = this.scaledResource( ":/process-interface/new-instance.png" );
   this.newInstanceButton.setScaledFixedSize( 24, 24 );
   this.newInstanceButton.toolTip =
      tr( "Nouvelle instance : glisser sur le bureau PixInsight pour mémoriser les sources et réglages.", "New instance: drag to the PixInsight workspace to save the sources and settings." );
   this.newInstanceButton.onMousePress = function()
   {
      this.hasFocus = true;
      this.pushed = false;
      self.syncIds();
      exportInstanceParameters();
      self.newInstance();
   };

   this.resetButton = new PushButton( this );
   this.resetButton.text = tr( "Réinitialiser", "Reset" );
   this.resetButton.onClick = function()
   {
      var ids = P.ids.slice(0), language = P.language;
      P = cloneDefaults();
      P.ids = ids;
      P.language = language;
      self.refreshControlsFromP();
      self.schedulePreview();
   };

   this.applyButton = new PushButton( this );
   this.applyButton.text = tr( "Créer l'image finale", "Create final image" );
   this.applyButton.toolTip = tr(
      "<p>Calcule l'image finale depuis les sources originales. Les valeurs déjà dans [0,1] sont conservées.</p>" +
      "<p>Si nécessaire, une translation et une remise à l'échelle communes R/G/B ramènent la sortie dans [0,1], sans écrêtage. Elles s'appliquent après le mixage, le pied cible et les offsets, uniquement à l'image finale.</p>" +
      "<p>Le facteur et le décalage sont indiqués dans la console après le calcul.</p>",
      "<p>Renders the final image from the original sources. Values already in [0,1] are preserved.</p>" +
      "<p>If needed, a common R/G/B shift and scale bring the output into [0,1] without clipping. They apply after mixing, the foot target and offsets, to the final image only.</p>" +
      "<p>The scale and shift are reported in the console after rendering.</p>" );
   this.applyButton.onClick = function()
   {
      if ( self.rendering || self.checkingPreviewRange ) return;
      self.syncIds();
      self.timer.stop();
      self.rendering = true;
      self.enabled = false;
      try
      {
         fullRender(self);
         saveSettings();
      }
      catch ( e )
      {
         showError(self,errText(e));
         self.statusLabel.text = tr("<b>Erreur de rendu.</b>","<b>Rendering error.</b>");
      }
      finally
      {
         self.enabled = true;
         self.rendering = false;
      }
   };

   this.closeButton = new PushButton( this );
   this.closeButton.text = tr( "Fermer", "Close" );
   this.closeButton.onClick = function()
   {
      if ( self.rendering || self.checkingPreviewRange ) return;
      self.timer.stop();
      self.syncIds();
      saveSettings();
      self.ok();
   };

   var br = new HorizontalSizer;
   br.spacing = 6;
   br.add( this.newInstanceButton );
   br.add( this.resetButton );
   br.addStretch();
   br.add( this.applyButton );
   br.add( this.closeButton );

   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add( headerRow );
   this.sizer.add( this.subtitleLabel );
   this.sizer.add( mainRow, 100 );
   this.sizer.add( br );

   // Deferred preview --------------------------------------------------------
   this.timer = new Timer;
   this.timer.periodic = false;
   this.timer.interval = 0.25;
   this.timer.onTimeout = function() { self.refreshPreview(); };

   this.updateSums();
   this.updatePresetFromMatrix();
   // Measure the compact layout even when saved preferences open the panel.
   this.advancedGroup.visible = false;
   this.adjustToContents();
   this.setMinWidth( this.logicalPixelsToPhysical( 1320 ) );
   this.setMinHeight( this.logicalPixelsToPhysical( 820 ) );
   this.compactSize = { width: this.width, height: this.height };
   this.updateAdvancedVisibility();
}

captureInterfaceState()
{
   return {
      bitmap: this.previewBox.bitmap,
      fit: this.previewBox.fit,
      zoom: this.previewBox.zoom,
      x: this.previewBox.horizontalScrollPosition,
      y: this.previewBox.verticalScrollPosition,
      lastMix: this.lastMix,
      presetItem: this.presetCombo.currentItem,
      windowWidth: this.width,
      windowHeight: this.height,
      compactWidth: this.advancedExpanded ? this.compactSize.width : this.width,
      compactHeight: this.advancedExpanded ? this.compactSize.height : this.height
   };
}

restoreInterfaceState( state )
{
   if ( state == null ) return;
   this.compactSize = {
      width: safeNumber( state.compactWidth, this.compactSize.width ),
      height: safeNumber( state.compactHeight, this.compactSize.height )
   };
   this.resize( safeNumber( state.windowWidth, this.width ),
                safeNumber( state.windowHeight, this.height ) );
   this.presetCombo.currentItem = state.presetItem;
   this.presetButton.enabled = state.presetItem >= 0 && state.presetItem < PRESET_CUSTOM;
   if ( CACHE != null )
      this.refreshPreview();
   else if ( state.bitmap != null )
   {
      this.lastMix = state.lastMix;
      this.previewBox.setBitmap( state.bitmap );
      if ( state.lastMix != null )
      {
         this.histControl.setData( state.lastMix.hist );
         this.setClipLabel( state.lastMix.low, state.lastMix.high, state.lastMix.n,
                           tr( "Ancienne sortie estimée", "Previous output estimate" ), state.lastMix.transform );
      }
      this.statusLabel.text = tr(
         "<b><font color=\"#cc2020\">Préparer/rafraîchir le preview pour activer le calcul live.</font></b>",
         "<b><font color=\"#cc2020\">Prepare/refresh the preview to enable live updates.</font></b>" );
   }
   this.previewBox.fit = state.fit;
   this.previewBox.zoom = state.zoom;
   if ( state.fit ) this.previewBox.zoomFit(); else this.previewBox.updateRange();
   if ( !state.fit )
   {
      this.previewBox.horizontalScrollPosition = state.x;
      this.previewBox.verticalScrollPosition = state.y;
   }
}

syncIds()
{
   for ( var s = 0; s < 6; ++s )
   {
      var v = this.sourceLists[s].currentView;
      P.ids[s] = ( v == null || v.isNull ) ? "" : v.id;
   }
}

updatePresetFromMatrix()
{
   var index = presetIndexForMatrix( P.weights );
   this.presetCombo.currentItem = index;
   this.presetButton.enabled = index < PRESET_CUSTOM;
}

updateAdvancedVisibility()
{
   var expanded = !!P.showAdvanced;
   this.advancedCheck.checked = expanded;
   if ( expanded == this.advancedExpanded )
   {
      this.advancedGroup.visible = expanded;
      return;
   }
   if ( expanded )
      this.compactSize = { width: this.width, height: this.height };
   this.advancedExpanded = expanded;
   this.advancedGroup.visible = expanded;
   if ( expanded )
   {
      this.adjustToContents();
      this.resize( Math.max( this.width, this.compactSize.width ),
                   Math.max( this.height, this.compactSize.height ) );
   }
   else
   {
      // Flexible preview/histogram sizers retain extra space after hiding a
      // child; restore the size measured before expansion explicitly.
      this.resize( this.compactSize.width, this.compactSize.height );
   }
}

updateDisplayControls()
{
   // This warning describes an active display transform, not the stored choice
   // when non-linear data are displayed directly. It is independent of status.
   var usesSTF = P.mode == 0 && P.linearDisplayMode != 2;
   this.linearDisplayCombo.enabled = P.mode == 0;
   this.displayLabel.text = P.mode == 0 ? tr( "Affichage linéaire :", "Linear display:" ) : tr( "Affichage : Direct", "Display: Direct" );
   this.stfLevelLabel.enabled = usesSTF;
   this.stfLevelCombo.enabled = usesSTF;
   this.unlinkedWarningLabel.visible = P.mode == 0 && P.linearDisplayMode == 1;
}

refreshControlsFromP()
{
   this.updating = true;
   try
   {
      for ( var o = 0; o < 3; ++o )
         for ( var s = 0; s < 6; ++s )
            this.weightControls[o][s].setValue( P.weights[o][s] );
      this.languageCombo.currentItem = P.language == "en" ? 1 : 0;
      this.modeCombo.currentItem = P.mode;
      this.backgroundCheck.checked = P.backgroundNormalization;
      this.floorTargetControl.setValue( P.histFloorTarget );
      this.floorTargetControl.enabled = P.backgroundNormalization;
      for ( var c = 0; c < 3; ++c )
      {
         this.offsetCoarseControls[c].setValue( P.offsetsCoarse[c] );
         this.offsetFineControls[c].setValue( P.offsetsFine[c] );
      }
      this.linearDisplayCombo.currentItem = P.linearDisplayMode;
      this.stfLevelCombo.currentItem = P.stfLevel;
      this.updateDisplayControls();
      this.previewSizeCombo.currentItem = P.previewSizeIndex;
      this.histModeCombo.currentItem = P.histMode;
      this.histControl.setMode( P.histMode );
      this.histScaleCombo.currentItem = P.histScale;
      this.histControl.setScale( P.histScale );
      this.updateHistogramViewport( P.histZoomIndex, P.histStart );
   }
   finally
   {
      this.updating = false;
   }
   this.updateSums();
   this.updatePresetFromMatrix();
   this.updateAdvancedVisibility();
}

updateHistogramViewport( zoomIndex, start )
{
   P.histZoomIndex = clamp( Math.round( safeNumber( zoomIndex, 0 ) ), 0, HIST_ZOOMS.length - 1 );
   var maxStart = 1 - 1/HIST_ZOOMS[P.histZoomIndex];
   P.histStart = clamp( safeNumber( start, 0 ), 0, maxStart );
   this.histZoomCombo.currentItem = P.histZoomIndex;
   this.histStartControl.setRange( 0, maxStart );
   this.histStartControl.setValue( P.histStart );
   this.histStartControl.enabled = ( P.histZoomIndex != 0 );
   this.histControl.setViewport( HIST_ZOOMS[P.histZoomIndex], P.histStart );
}

updateSums()
{
   for ( var o = 0; o < 3; ++o )
   {
      var sum = 0;
      for ( var s = 0; s < 6; ++s )
         sum += P.weights[o][s];
      this.sumLabels[o].text = "Σ = " + sum.toFixed(3);
   }
}

setMatrix( m, schedule )
{
   this.updating = true;
   try
   {
      for ( var o = 0; o < 3; ++o )
         for ( var s = 0; s < 6; ++s )
         {
            P.weights[o][s] = m[o][s];
            this.weightControls[o][s].setValue( m[o][s] );
         }
   }
   finally
   {
      this.updating = false;
   }
   this.updateSums();
   this.updatePresetFromMatrix();
   if ( schedule !== false )
      this.schedulePreview();
}

applyPreset( index )
{
   if ( index < 0 || index >= PRESET_MATRICES.length ) return;
   this.setMatrix( PRESET_MATRICES[index] );
}

schedulePreview( live )
{
   if ( this.updating )
      return;
   if ( CACHE == null )
   {
      this.timer.stop();
      this.statusLabel.text = tr( "<b><font color=\"#cc2020\">Préparer le preview pour activer le calcul live.</font></b>", "<b><font color=\"#cc2020\">Prepare the preview to enable live updates.</font></b>" );
      return;
   }
   // Live slider updates keep an already scheduled frame, so continuous motion
   // cannot postpone all rendering until the mouse is released.
   if ( live === true && this.timer.isRunning )
      return;
   this.timer.stop();
   this.timer.start();
}

setClipLabel( low, high, n, prefix, transform )
{
   var a = [];
   for ( var c = 0; c < 3; ++c )
      a[c] = { lo: 100*low[c]/n, hi: 100*high[c]/n };
   this.clipLabel.text = prefix + tr(" — hors [0,1] : "," — outside [0,1]: ") +
      format( tr( "R bas %.4f %% / haut %.4f %%   |   G bas %.4f %% / haut %.4f %%   |   B bas %.4f %% / haut %.4f %%", "R low %.4f %% / high %.4f %%   |   G low %.4f %% / high %.4f %%   |   B low %.4f %% / high %.4f %%" ),
              a[0].lo, a[0].hi, a[1].lo, a[1].hi, a[2].lo, a[2].hi );
   if ( transform && transform.applied )
      this.clipLabel.text += format(tr(" — normalisation commune ×%.6f (ajout %.6f)"," — common normalization ×%.6f (addition %.6f)"),transform.scale,transform.addition);
}

refreshPreview()
{
   if ( CACHE == null || this.checkingPreviewRange )
      return;
   var t0 = Date.now();
   try
   {
      var mix = mixReduced( CACHE, this );
      var bmp = previewBitmap( CACHE, mix );
      this.lastMix = mix;
      this.previewBox.setBitmap( bmp );
      this.histControl.setData( mix.hist );
      this.setClipLabel( mix.low, mix.high, mix.n, tr( "Sortie estimée (preview réduit)", "Output estimate (reduced preview)" ), mix.transform );
      this.statusLabel.text = format( tr( "Aperçu %dx%d à jour en %.2f s", "Preview %dx%d updated in %.2f s" ), CACHE.ww, CACHE.wh, (Date.now()-t0)/1000 );
   }
   catch ( e )
   {
      console.criticalln( TITLE + " preview : " + errText(e) );
      if ( e && e.stack ) console.writeln( e.stack );
      this.statusLabel.text = tr( "<b>Erreur preview :</b> ", "<b>Preview error:</b> " ) + errText(e);
   }
}
};

function main()
{
   loadSettings();
   CACHE = null;
   var state = null, dialog = null;
   try
   {
      for ( ;; )
      {
         dialog = new MixerDialog;
         if ( state != null ) dialog.restoreInterfaceState(state);
         dialog.execute();
         dialog.timer.stop();
         dialog.timer.onTimeout = null;
         var relaunch = dialog.relaunch;
         state = relaunch ? dialog.relaunchState : null;
         dialog.relaunchState = null;
         dialog.lastMix = null;
         dialog.previewBox.setBitmap(null);
         dialog = null;
         if ( !relaunch ) break;
      }
      saveSettings();
   }
   finally
   {
      if ( dialog != null )
      {
         dialog.timer.stop();
         dialog.timer.onTimeout = null;
         dialog.lastMix = null;
         dialog.previewBox.setBitmap(null);
      }
      CACHE = null;
      state = null;
   }
}

main();
