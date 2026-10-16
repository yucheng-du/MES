package com.mesnext.hardware

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

object LocaleStrings {
    const val KEY = "mes.locale"
    fun locale(context: Context): String = context.getSharedPreferences("mes-hardware", Context.MODE_PRIVATE)
        .getString(KEY, "zh-CN").takeIf { it == "en-US" } ?: "zh-CN"
    fun set(context: Context, locale: String) {
        require(locale == "zh-CN" || locale == "en-US")
        context.getSharedPreferences("mes-hardware", Context.MODE_PRIVATE).edit().putString(KEY, locale).apply()
    }
    fun localizedContext(context: Context): Context {
        val config = Configuration(context.resources.configuration)
        config.setLocale(Locale.forLanguageTag(locale(context)))
        return context.createConfigurationContext(config)
    }
    fun get(context: Context, id: Int, vararg args: Any): String = localizedContext(context).getString(id, *args)
}
