plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dronetapp.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.dronetapp.app"
        // 적응형 아이콘(PNG 불필요)을 항상 사용하기 위해 minSdk 26
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 디버그 서명으로도 설치 가능하도록 별도 서명 설정은 두지 않음
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // out/ 자산은 이미 압축/해시되어 있으므로 추가 압축에서 제외(로딩 안정성)
    androidResources {
        noCompress += listOf("js", "css", "txt", "svg", "woff", "woff2", "json")
        // 기본 무시 패턴에는 "<dir>_*" 가 있어 Next.js의 _next 폴더가 통째로 빠진다.
        // 밑줄 폴더(_next, _not-found)를 포함하도록 무시 패턴을 재정의한다.
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
