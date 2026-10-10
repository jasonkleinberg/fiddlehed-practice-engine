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
 *     solo    — "1" = single-tune mode for lesson pages: the tune picker is
 *               hidden and the student stays on this tune. Needs tune="".
 *     full    — (solo only) address of the full Practice Engine page. Shows
 *               "Want a different tune? Open the full Practice Engine". Leave it
 *               out to use $full_default below. Must be a fiddlehed.com page.
 *
 *     Lesson page:      [practice-engine tune="bile-em-cabbage-down" solo="1"]
 *     Practice Toolkit: [practice-engine]
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
			'solo'   => '',
			'full'   => '',
		),
		$atts,
		'practice-engine'
	);

	$base = 'https://practice.fiddlehed.com/'; // moved 2026-10-03: same-site as fiddlehed.com so Safari allows analytics in the embed
	$src  = $base;
	if ( ! empty( $atts['tune'] ) ) {
		// sanitize_title turns "Oh Susanna" or "oh-susanna" into a safe slug.
		$src = add_query_arg( 'tune', sanitize_title( $atts['tune'] ), $base );
	}

	// v1.38: single-tune lesson-page mode.
	// TODO: set this to the Practice Toolkit page's address once it's live.
	$full_default = '';
	if ( ! empty( $atts['solo'] ) && '0' !== $atts['solo'] && ! empty( $atts['tune'] ) ) {
		$src  = add_query_arg( 'solo', '1', $src );
		$full = ! empty( $atts['full'] ) ? $atts['full'] : $full_default;
		if ( ! empty( $full ) ) {
			$src = add_query_arg( 'full', rawurlencode( esc_url_raw( $full ) ), $src );
		}
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
