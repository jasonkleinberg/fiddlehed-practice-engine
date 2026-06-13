<?php
/**
 * FiddleHed Practice Engine — WordPress embed shortcode
 * -----------------------------------------------------
 * Lets you drop the practice engine onto any lesson page and choose the tune
 * right in the editor, no HTML:
 *
 *     [practice-engine tune="oh-susanna"]
 *
 * Optional attributes:
 *     tune    — the tune slug (matches a "slug" in music/index.json). Omit to
 *               open the default (first) tune.
 *     height  — iframe height in px (default 400). Bump it if controls clip on
 *               narrow screens.
 *
 *     [practice-engine tune="orange-blossom-special" height="440"]
 *
 * The page opens to that tune and returns to it on refresh, because the choice
 * lives in the URL — a student who switches tunes snaps back on reload.
 *
 * INSTALL (pick one, ~2 minutes):
 *   A) Code Snippets plugin (safest): Snippets → Add New → paste everything
 *      BELOW the opening <?php line → set "Run everywhere" → Save & Activate.
 *   B) Theme functions.php (use a CHILD theme): Appearance → Theme File Editor →
 *      functions.php → paste the function + add_shortcode line at the end.
 *
 * If you ever move the app off jkleinberg.com, change $base below.
 */

function fiddlehed_practice_engine_shortcode( $atts ) {
	$atts = shortcode_atts(
		array(
			'tune'   => '',
			'height' => '400',
		),
		$atts,
		'practice-engine'
	);

	$base = 'https://jkleinberg.com/fiddlehed-practice-engine/';
	$src  = $base;
	if ( ! empty( $atts['tune'] ) ) {
		// sanitize_title turns "Oh Susanna" or "oh-susanna" into a safe slug.
		$src = add_query_arg( 'tune', sanitize_title( $atts['tune'] ), $base );
	}

	$height = max( 240, intval( $atts['height'] ) );

	return sprintf(
		'<iframe src="%s" title="FiddleHed Practice Engine" loading="lazy" ' .
		'allow="autoplay" ' .
		'style="width:100%%;max-width:680px;height:%dpx;border:0;display:block;margin:1rem 0;"></iframe>',
		esc_url( $src ),
		$height
	);
}
add_shortcode( 'practice-engine', 'fiddlehed_practice_engine_shortcode' );
