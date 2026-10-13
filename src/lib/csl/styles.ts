/** 本文件由 scripts/gen-csl-ts.mjs 生成，请勿手改；改 .csl 后重新运行生成脚本。 */

export const GB_CSL_XML = `
<?xml version="1.0" encoding="utf-8"?>
<!-- 来源：https://github.com/citation-style-language/styles/blob/master/china-national-standard-gb-t-7714-2015-numeric.csl （CC BY-SA 3.0）；文件名沿用项目规范命名 -->
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text" name-as-sort-order="all" sort-separator=" " demote-non-dropping-particle="never" initialize-with=" " initialize-with-hyphen="false" page-range-format="expanded" default-locale="zh-CN">
  <info>
    <title>China National Standard GB/T 7714-2015 (numeric, 中文)</title>
    <id>http://www.zotero.org/styles/china-national-standard-gb-t-7714-2015-numeric</id>
    <link href="http://www.zotero.org/styles/china-national-standard-gb-t-7714-2015-numeric" rel="self"/>
    <link href="https://std.samr.gov.cn/gb/search/gbDetailed?id=71F772D8055ED3A7E05397BE0A0AB82A" rel="documentation"/>
    <author>
      <name>牛耕田</name>
      <email>buffalo_d@163.com</email>
    </author>
    <contributor>
      <name>Zeping Lee</name>
      <email>zepinglee@gmail.com</email>
    </contributor>
    <category citation-format="numeric"/>
    <category field="generic-base"/>
    <summary>The Chinese GB/T 7714-2015 numeric style</summary>
    <updated>2024-01-22T22:07:03+08:00</updated>
    <rights license="http://creativecommons.org/licenses/by-sa/3.0/">This work is licensed under a Creative Commons Attribution-ShareAlike 3.0 License</rights>
  </info>
  <locale xml:lang="zh">
    <date form="text">
      <date-part name="year" suffix="年" range-delimiter="&#8212;"/>
      <date-part name="month" form="numeric" suffix="月" range-delimiter="&#8212;"/>
      <date-part name="day" suffix="日" range-delimiter="&#8212;"/>
    </date>
    <terms>
      <term name="edition" form="short">版</term>
      <term name="open-quote">“</term>
      <term name="close-quote">”</term>
      <term name="open-inner-quote">‘</term>
      <term name="close-inner-quote">’</term>
    </terms>
  </locale>
  <locale>
    <date form="numeric">
      <date-part name="year" range-delimiter="/"/>
      <date-part name="month" form="numeric-leading-zeros" prefix="-" range-delimiter="/"/>
      <date-part name="day" form="numeric-leading-zeros" prefix="-" range-delimiter="/"/>
    </date>
    <terms>
      <term name="page-range-delimiter">-</term>
    </terms>
  </locale>
  <!-- 主要责任者 -->
  <macro name="author">
    <names variable="author">
      <name>
        <name-part name="family" text-case="uppercase"/>
      </name>
      <!-- <institution/> -->
      <substitute>
        <names variable="composer"/>
        <names variable="illustrator"/>
        <names variable="director"/>
        <choose>
          <if variable="container-title" match="none">
            <names variable="editor"/>
          </if>
        </choose>
      </substitute>
    </names>
  </macro>
  <!-- 题名 -->
  <macro name="title">
    <group delimiter=", ">
      <group delimiter=": ">
        <text variable="title"/>
        <group delimiter="&#8195;">
          <choose>
            <if variable="container-title" type="chapter entry-dictionary entry-encyclopedia paper-conference" match="none">
              <text macro="volume"/>
              <text variable="volume-title"/>
            </if>
          </choose>
          <choose>
            <if type="article article-journal" match="none">
              <!-- 预印本和期刊文章的编号用于其他位置 -->
              <text variable="number"/>
            </if>
          </choose>
          <choose>
            <if type="collection manuscript personal_communication" match="any">
              <!-- 档案的卷宗号 -->
              <text variable="archive_location"/>
            </if>
          </choose>
        </group>
      </group>
      <choose>
        <if variable="container-title" type="paper-conference" match="none">
          <choose>
            <if variable="event-date">
              <text variable="event-place"/>
              <date variable="event-date" form="text"/>
            </if>
          </choose>
        </if>
      </choose>
    </group>
    <group delimiter="/" prefix="[" suffix="]">
      <text macro="type-id"/>
      <text macro="medium-id"/>
    </group>
  </macro>
  <!-- 书籍的卷号（“第 x 卷”或“第 x 册”） -->
  <macro name="volume">
    <choose>
      <if type="article article-journal article-magazine article-newspaper periodical" match="none">
        <choose>
          <if is-numeric="volume">
            <group delimiter=" ">
              <label variable="volume" form="short" text-case="capitalize-first"/>
              <text variable="volume"/>
            </group>
          </if>
          <else>
            <text variable="volume"/>
          </else>
        </choose>
      </if>
    </choose>
  </macro>
  <!-- 文献类型标识 -->
  <macro name="type-id">
    <choose>
      <if type="article bill collection hearing legal_case legislation personal_communication regulation treaty" match="any">
        <!-- 档案，A：分类保存以备查考的文件和材料，如人事档案、科技档案、法律法规、政府文件等。
          article 为预印本，符合“科技档案”
        -->
        <text value="A"/>
      </if>
      <else-if type="article-journal article-magazine periodical" match="any">
        <text value="J"/>
      </else-if>
      <else-if type="article-newspaper">
        <text value="N"/>
      </else-if>
      <else-if type="book chapter classic entry-dictionary entry-encyclopedia" match="any">
        <text value="M"/>
      </else-if>
      <else-if type="dataset">
        <text value="DS"/>
      </else-if>
      <else-if type="map">
        <text value="CM"/>
      </else-if>
      <else-if type="paper-conference">
        <text value="C"/>
      </else-if>
      <else-if type="patent">
        <text value="P"/>
      </else-if>
      <else-if type="post post-weblog webpage" match="any">
        <text value="EB"/>
      </else-if>
      <else-if type="report">
        <text value="R"/>
      </else-if>
      <else-if type="software">
        <text value="CP"/>
      </else-if>
      <else-if type="standard">
        <text value="S"/>
      </else-if>
      <else-if type="thesis">
        <text value="D"/>
      </else-if>
      <else>
        <text value="Z"/>
      </else>
    </choose>
  </macro>
  <!-- 文献载体标识 -->
  <macro name="medium-id">
    <choose>
      <if variable="medium">
        <text variable="medium"/>
      </if>
      <else-if variable="URL DOI" match="any">
        <text value="OL"/>
      </else-if>
    </choose>
  </macro>
  <!-- 其他责任者 -->
  <macro name="secondary-contributors">
    <names variable="translator">
      <name>
        <name-part name="family" text-case="uppercase"/>
      </name>
      <!-- <institution/> -->
      <label form="short" prefix=", "/>
    </names>
  </macro>
  <!-- 专著主要责任者 -->
  <macro name="container-contributors">
    <names variable="editor">
      <name>
        <name-part name="family" text-case="uppercase"/>
      </name>
      <!-- <institution/> -->
      <substitute>
        <names variable="editorial-director"/>
        <names variable="collection-editor"/>
        <names variable="container-author"/>
      </substitute>
    </names>
  </macro>
  <!-- 专著题名 -->
  <macro name="container-booklike">
    <group delimiter=", ">
      <choose>
        <if variable="container-title">
          <!-- 优先使用专著或会议论文集的题名 -->
          <group delimiter=": ">
            <text variable="container-title"/>
            <text macro="volume"/>
          </group>
        </if>
        <else-if type="paper-conference">
          <!-- 有些会议没有论文集，使用会议名代替 -->
          <text variable="event-title"/>
        </else-if>
      </choose>
      <!-- 会议时间和会议地点 -->
      <choose>
        <if type="paper-conference" variable="event-date" match="all">
          <date variable="event-date" form="text"/>
          <text variable="event-place"/>
        </if>
      </choose>
    </group>
  </macro>
  <!-- 连续出版物中的出处项 -->
  <macro name="container-periodical">
    <choose>
      <if type="article-newspaper">
        <!-- 报纸的出处项：“刊名, 出版日期(版次): 页码[引用日期]” -->
        <group delimiter=", ">
          <text variable="container-title"/>
          <text macro="issued-date"/>
        </group>
        <text variable="page" prefix="(" suffix=")"/>
      </if>
      <else>
        <!-- 期刊、杂志的出处项：“刊名, 年, 卷(期): 页码[引用日期]” -->
        <group delimiter=": ">
          <group>
            <group delimiter=", ">
              <text variable="container-title"/>
              <text macro="issued-year"/>
              <text variable="volume"/>
            </group>
            <text variable="issue" prefix="(" suffix=")"/>
          </group>
          <text variable="page"/>
        </group>
      </else>
    </choose>
    <text macro="accessed-date"/>
  </macro>
  <!-- 版本项 -->
  <macro name="edition">
    <choose>
      <if is-numeric="edition">
        <group delimiter=" ">
          <number variable="edition" form="ordinal"/>
          <label variable="edition" form="short"/>
        </group>
      </if>
      <else>
        <text variable="edition"/>
      </else>
    </choose>
  </macro>
  <!-- 连续出版物的年卷期 -->
  <macro name="year-volume-issue">
    <group delimiter=", ">
      <text macro="issued-year"/>
      <text variable="volume"/>
    </group>
    <text variable="issue" prefix="(" suffix=")"/>
  </macro>
  <!-- 出版项 -->
  <macro name="publisher">
    <choose>
      <if type="patent">
        <!-- 专利的出版项格式“公告日期[引用日期]” -->
        <text macro="issued-date"/>
        <text macro="accessed-date"/>
      </if>
      <else-if type="book chapter paper-conference periodical thesis" variable="archive archive-place publisher publisher-place page" match="any">
        <!-- 非纯电子资源的格式“出版地: 出版者, 出版年: 页码[引用日期]” -->
        <group delimiter=": ">
          <group delimiter=", ">
            <group delimiter=": ">
              <choose>
                <if variable="publisher publisher-place" match="any">
                  <text variable="publisher-place"/>
                  <text variable="publisher"/>
                </if>
                <else>
                  <!-- 档案的馆藏地以及收藏机构或单位 -->
                  <text variable="archive-place"/>
                  <text variable="archive"/>
                </else>
              </choose>
            </group>
            <text macro="issued-year"/>
          </group>
          <text variable="page"/>
        </group>
        <text macro="accessed-date"/>
      </else-if>
      <else-if variable="URL DOI" match="any">
        <!-- 纯电子资源联机网络文献的格式“(更新或修改日期)[引用日期]”。
          原国标中，电子公告、无出版社的报告、法规等文献都可以作为“纯电子文献”。
        -->
        <text macro="issued-date" prefix="(" suffix=")"/>
        <text macro="accessed-date"/>
      </else-if>
      <else>
        <text macro="issued-year"/>
      </else>
    </choose>
  </macro>
  <!-- 出版年 -->
  <macro name="issued-year">
    <choose>
      <if variable="issued">
        <choose>
          <if is-uncertain-date="issued">
            <!-- 出版年无法确定时, 估计的出版年应置于方括号内。 -->
            <date variable="issued" form="numeric" date-parts="year" prefix="[" suffix="]"/>
          </if>
          <else>
            <date variable="issued" form="numeric" date-parts="year"/>
          </else>
        </choose>
      </if>
      <else-if type="article-journal" variable="available-date" match="all">
        <!-- 网络首发（advance online publication）的期刊文章的日期使用 available-date -->
        <date variable="available-date" form="numeric" date-parts="year"/>
      </else-if>
      <else>
        <!-- 选取引用日期的年份作为估计的出版年 -->
        <date variable="accessed" form="numeric" date-parts="year" prefix="[" suffix="]"/>
      </else>
    </choose>
  </macro>
  <!-- 出版日期，用于报纸文献、专利的“公告日期或公开日期”、电子资源的“更新或修改日期” -->
  <macro name="issued-date">
    <date variable="issued" form="numeric"/>
  </macro>
  <!-- 引用日期 -->
  <macro name="accessed-date">
    <choose>
      <if variable="URL DOI" match="any">
        <date variable="accessed" form="numeric" prefix="[" suffix="]"/>
      </if>
    </choose>
  </macro>
  <!-- 获取和访问路径、数字对象唯一标识符 -->
  <macro name="access">
    <group delimiter=". ">
      <text variable="URL"/>
      <text variable="DOI" prefix="DOI:"/>
    </group>
  </macro>
  <!-- 参考文献表格式 -->
  <macro name="entry-layout">
    <group delimiter=". ">
      <text macro="author"/>
      <choose>
        <if type="periodical">
          <!-- 4.3 连续出版物 -->
          <text macro="title"/>
          <text macro="year-volume-issue"/>
          <text macro="publisher"/>
        </if>
        <else-if type="article-journal article-magazine article-newspaper" match="any">
          <!-- 4.4 连续出版物中的析出文献 -->
          <text macro="title"/>
          <text macro="container-periodical"/>
        </else-if>
        <else-if type="patent">
          <!-- 4.5 专利文献 -->
          <text macro="title"/>
          <text macro="publisher"/>
        </else-if>
        <else-if type="dataset post post-weblog software webpage" match="any">
          <!-- 4.6 电子资源 -->
          <text macro="title"/>
          <text macro="publisher"/>
        </else-if>
        <else-if type="chapter entry-dictionary entry-encyclopedia paper-conference" variable="container-title" match="any">
          <!-- 4.2 专著中的析出文献 -->
          <group delimiter="//">
            <group delimiter=". ">
              <text macro="title"/>
              <text macro="secondary-contributors"/>
            </group>
            <group delimiter=". ">
              <text macro="container-contributors"/>
              <text macro="container-booklike"/>
            </group>
          </group>
          <text macro="edition"/>
          <text macro="publisher"/>
        </else-if>
        <else>
          <!-- 4.1 专著 -->
          <text macro="title"/>
          <text macro="secondary-contributors"/>
          <text macro="edition"/>
          <text macro="publisher"/>
        </else>
      </choose>
      <text macro="access"/>
    </group>
  </macro>
  <citation collapse="citation-number" after-collapse-delimiter=",">
    <sort>
      <key variable="citation-number"/>
    </sort>
    <layout vertical-align="sup" delimiter="," prefix="[" suffix="]">
      <text variable="citation-number"/>
    </layout>
  </citation>
  <bibliography entry-spacing="0" et-al-min="4" et-al-use-first="3" second-field-align="flush">
    <!-- 取消这部分注释可以开启 CSL-M 的多语言功能：按照文献的语言输出“et al.”等术语 -->
    <!-- <layout suffix="." locale="en"><text variable="citation-number" prefix="[" suffix="]"/><text macro="entry-layout"/></layout>
    -->
    <layout suffix=".">
      <text variable="citation-number" prefix="[" suffix="]"/>
      <text macro="entry-layout"/>
    </layout>
  </bibliography>
</style>
`

export const APA_CSL_XML = `
<?xml version="1.0" encoding="utf-8"?>
<!-- 来源：https://github.com/citation-style-language/styles/blob/master/apa.csl （CC BY-SA 3.0，APA Style 7th edition） -->
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" demote-non-dropping-particle="never" initialize-with=". " names-delimiter=", " page-range-format="expanded" version="1.0">
  <!-- This file was generated by the Style Variant Builder <https://github.com/citation-style-language/style-variant-builder>. To contribute changes, modify the template and regenerate variants. -->
  <info>
    <title>APA Style 7th edition</title>
    <title-short>Publication Manual of the American Psychological Association, with Bluebook</title-short>
    <id>http://www.zotero.org/styles/apa</id>
    <link href="http://www.zotero.org/styles/apa" rel="self"/>
    <link href="http://www.zotero.org/styles/apa-6th-edition" rel="template"/>
    <link href="https://apastyle.apa.org/style-grammar-guidelines/references" rel="documentation"/>
    <link href="https://zotero.org/groups/2205533/collections/MR2N872S" rel="documentation"/>
    <author>
      <name>Brenton M. Wiernik</name>
      <email>zotero@wiernik.org</email>
      <uri>https://orcid.org/0000-0001-9560-6336</uri>
    </author>
    <author>
      <name>Andrew Dunning</name>
      <uri>https://orcid.org/0000-0003-0464-5036</uri>
    </author>
    <contributor>
      <name>Jay Pfaffman</name>
      <email>jay@literatecomputing.com</email>
    </contributor>
    <category citation-format="author-date"/>
    <category field="anthropology"/>
    <category field="communications"/>
    <category field="generic-base"/>
    <category field="law"/>
    <category field="medicine"/>
    <category field="psychology"/>
    <category field="social_science"/>
    <category field="sociology"/>
    <summary>Author-date system of the Publication Manual of the American Psychological Association (2020)</summary>
    <updated>2026-02-07T00:00:00+00:00</updated>
    <rights license="http://creativecommons.org/licenses/by-sa/3.0/">This work is licensed under a Creative Commons Attribution-ShareAlike 3.0 License</rights>
  </info>
  <locale xml:lang="en">
    <terms>
      <term name="ad"> C.E.</term>
      <term name="bc"> B.C.E.</term>
      <term form="short" name="circa">ca.</term>
      <term name="guest">
        <single>guest expert</single>
        <multiple>guest experts</multiple>
      </term>
      <term form="short" name="illustrator">illus.</term>
      <term form="short" name="interviewer">
        <single>interviewer</single>
        <multiple>interviewers</multiple>
      </term>
      <term form="short" name="legislation">Pub. L.</term>
      <term name="manuscript">unpublished manuscript</term>
      <term form="verb" name="performer">recorded by</term>
      <term name="post">online post</term>
      <term name="review-of">review of the</term>
      <term form="short" name="review-of">review of</term>
      <term name="software">computer software</term>
      <term name="dataset">data set</term>
      <term form="short" name="supplement">
        <single>suppl.</single>
        <multiple>suppls.</multiple>
      </term>
    </terms>
  </locale>
  <locale xml:lang="da">
    <terms>
      <term name="et-al">et al.</term>
    </terms>
  </locale>
  <locale xml:lang="de">
    <terms>
      <term name="et-al">et al.</term>
    </terms>
  </locale>
  <locale xml:lang="es">
    <terms>
      <term name="from">de</term>
    </terms>
  </locale>
  <locale xml:lang="fr">
    <terms>
      <term form="short" name="editor">
        <single>éd.</single>
        <multiple>éds.</multiple>
      </term>
    </terms>
  </locale>
  <locale xml:lang="nb">
    <terms>
      <term name="et-al">et al.</term>
    </terms>
  </locale>
  <locale xml:lang="nl">
    <terms>
      <term name="et-al">et al.</term>
    </terms>
  </locale>
  <locale xml:lang="nn">
    <terms>
      <term name="et-al">et al.</term>
    </terms>
  </locale>
  <locale xml:lang="pl">
    <terms>
      <term name="et-al">i in.</term>
    </terms>
  </locale>
  <locale xml:lang="ro">
    <terms>
      <term name="et-al">et al.</term>
    </terms>
  </locale>
  <!-- Contents:

       APA uses four main reference elements:

        1. Author (APA 9.7-12)
        2. Date (APA 9.13-17)
        3. Title and descriptions (APA 9.18-22)
            3.1. Title (APA 9.18)
            3.2. Identifier (in parentheses) (APA 9.19)
            3.3. Description [in square brackets] (APA 9.21-22)
        4. Source (APA 9.23-37)
            4.1. Serial sources (APA 9.25-27)
            4.2. Monographic sources (APA 9.28)
            4.3. Publisher sources (APA 9.29)
            4.4. Database and archive sources (APA 9.30)
            4.5. Works with specific locations (APA 9.31)
            4.6. Social media and website sources (APA 9.32-33)
            4.7. DOI or URL (APA 9.34-36)

       A note on the source may follow the main reference elements:

        5. Publication history (APA 9.39-41)

       APA also provides parallel rules for legal references following The Bluebook: A Uniform System of Citation (chap. 11):

        6. Legal references
  -->
  <!-- APA categorizes all sources as serial (APA 9.25-27) or monographic (APA 9.28).

       Serial
       : article-journal article-magazine article-newspaper periodical post-weblog review review-book

       Serial or Monographic
       : interview paper-conference

         Monographic with any of \`collection-editor compiler editor editorial-director\`.
         A serial \`paper-conference\` is unpublished if it lacks any of \`issue page supplement-number volume\`.

       Monographic
       : article book broadcast chapter classic collection dataset document entry entry-dictionary entry-encyclopedia event figure graphic manuscript map motion_picture musical_score pamphlet patent performance personal_communication post report software song speech standard thesis webpage

       Legal
       : bill hearing legal_case legislation regulation treaty
  -->
  <!-- Equivalencies:

       \`classic\` == \`book\`
       \`document\` == \`report\` (but give full date)
       \`standard\` == \`report\`
       \`performance\` == \`speech\`
       \`event\` == \`speech\`
  -->
  <!-- Role equivalencies:

       \`compiler\` == \`editor\`
       \`organizer\`, \`curator\` == \`chair\`
       \`script-writer\` == \`director\`
       \`producer\` == \`director\` (but don't print both)
       \`guest\`, \`host\` == \`director\`
       \`series-creator\`, \`executive-producer\` == \`editor\`
  -->
  <!-- Reviews are detected if an item has type \`review\` or \`review-book\` or if it has any of the variables \`reviewed-title\`, \`reviewed-author\`, or \`reviewed-genre\`. For the latter case, reviews are commonly stored as types \`article-journal\`, \`article-magazine\`, \`article-newspaper\`, \`post-weblog\`, or \`webpage\`. -->
  <!-- Indigeneous knowledge: Assume the item is stored as \`document\` or \`speech\` and that Nation/Community, treaty territory, where the Elder lives, and topic are all stored in \`title\`. Cf. <https://libguides.norquest.ca/c.php?g=314831&p=5188823>. If the item is stored as \`interview\`, assume that Nation/Community, treaty territory, and topic are stored in \`title\`. 'Oral teaching' or similar is stored in \`archive\`, and where the Elder lives is stored in \`archive-place\`. -->
  <!-- Variable labels -->
  <macro name="label-chapter-number">
    <group delimiter=" ">
      <choose>
        <if is-numeric="chapter-number" type="song">
          <text text-case="capitalize-first" value="track"/>
        </if>
        <else-if is-numeric="chapter-number">
          <label text-case="capitalize-first" variable="chapter-number"/>
        </else-if>
      </choose>
      <text variable="chapter-number"/>
    </group>
  </macro>
  <macro name="label-edition">
    <group delimiter=" ">
      <choose>
        <if is-numeric="edition">
          <number form="ordinal" variable="edition"/>
          <label form="short" variable="edition"/>
        </if>
        <else>
          <text variable="edition"/>
        </else>
      </choose>
    </group>
  </macro>
  <macro name="label-issue">
    <group delimiter=" ">
      <label text-case="capitalize-first" variable="issue"/>
      <text variable="issue"/>
    </group>
  </macro>
  <macro name="label-locator">
    <!-- Abbreviate page and paragraph; leave other locator labels in long form (APA 8.13) -->
    <group delimiter=" ">
      <choose>
        <if locator="page">
          <label form="short" variable="locator"/>
        </if>
        <else-if match="any" type="bill hearing legal_case legislation regulation treaty">
          <!-- Bluebook-style labels for legal types -->
          <choose>
            <if locator="chapter paragraph section" match="any">
              <label form="symbol" variable="locator"/>
            </if>
            <else>
              <label text-case="capitalize-first" variable="locator"/>
            </else>
          </choose>
        </else-if>
        <else-if locator="paragraph">
          <label form="short" variable="locator"/>
        </else-if>
        <else-if is-numeric="locator">
          <label text-case="capitalize-first" variable="locator"/>
        </else-if>
        <!-- a non-numeric canonical reference is identified by its formatting and does not need a label, similar to a timestamp -->
        <else-if locator="chapter line verse" match="any"/>
        <else>
          <label text-case="capitalize-first" variable="locator"/>
        </else>
      </choose>
      <text variable="locator"/>
    </group>
  </macro>
  <macro name="label-number">
    <group delimiter=" ">
      <choose>
        <if type="standard"/>
        <else-if is-numeric="number" match="any" type="legislation patent regulation">
          <label form="short" text-case="capitalize-first" variable="number"/>
        </else-if>
      </choose>
      <text text-case="capitalize-first" variable="number"/>
    </group>
  </macro>
  <macro name="label-number-capitalized">
    <!-- alias for cross-compatibility of Bluebook macros -->
    <text macro="label-number"/>
  </macro>
  <macro name="label-number-article">
    <!-- APA example 6: Journal article with article number or eLocator -->
    <group delimiter=" ">
      <text term="article-locator" text-case="capitalize-first"/>
      <text variable="number"/>
    </group>
  </macro>
  <macro name="label-number-of-volumes">
    <group delimiter=" ">
      <choose>
        <if is-numeric="number-of-volumes">
          <label form="short" text-case="capitalize-first" variable="number-of-volumes"/>
          <group>
            <text prefix="1" term="page-range-delimiter"/>
            <number variable="number-of-volumes"/>
          </group>
        </if>
        <else>
          <text variable="number-of-volumes"/>
        </else>
      </choose>
    </group>
  </macro>
  <macro name="label-page">
    <group delimiter=" ">
      <label form="short" variable="page"/>
      <text variable="page"/>
    </group>
  </macro>
  <macro name="label-part-number">
    <group delimiter=" ">
      <choose>
        <if is-numeric="part-number">
          <!-- TODO: Replace with \`part-number\` label when CSL provides one -->
          <text form="short" term="part" text-case="capitalize-first"/>
        </if>
      </choose>
      <text text-case="capitalize-first" variable="part-number"/>
    </group>
  </macro>
  <macro name="label-section-symbol">
    <group delimiter=" ">
      <label form="symbol" variable="section"/>
      <text variable="section"/>
    </group>
  </macro>
  <macro name="label-supplement-number">
    <group delimiter=" ">
      <choose>
        <if is-numeric="supplement-number">
          <!-- TODO: Replace with \`supplement-number\` label when CSL provides one -->
          <text form="short" term="supplement" text-case="capitalize-first"/>
        </if>
      </choose>
      <text text-case="capitalize-first" variable="supplement-number"/>
    </group>
  </macro>
  <macro name="label-version">
    <group delimiter=" ">
      <label text-case="capitalize-first" variable="version"/>
      <text variable="version"/>
    </group>
  </macro>
  <macro name="label-volume">
    <group delimiter=" ">
      <choose>
        <if is-numeric="volume">
          <label form="short" text-case="capitalize-first" variable="volume"/>
        </if>
      </choose>
      <text text-case="capitalize-first" variable="volume"/>
    </group>
  </macro>
  <!-- 1. Author (APA 9.7-12) -->
  <macro name="author">
    <!-- Substitutes for missing authors: order prioritizes primary creators (e.g., composer, author) over secondary roles (e.g., editor, curator), with title as the final fallback. -->
    <names variable="composer">
      <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
      <label form="short" prefix=" (" suffix=")" text-case="title"/>
      <substitute>
        <names variable="author"/>
        <!-- \`narrator\` only cited in \`identifier-contributors\` -->
        <names variable="illustrator"/>
        <choose>
          <if type="broadcast">
            <names variable="script-writer director">
              <!-- Actors/performers and producers [not executive] not cited in APA style. -->
              <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
              <label prefix=" (" suffix=")" text-case="title"/>
            </names>
          </if>
        </choose>
        <names variable="director">
          <!-- For non-broadcast items, APA only cites directors and not writers. -->
          <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
          <label prefix=" (" suffix=")" text-case="title"/>
        </names>
        <names variable="guest host">
          <!-- TODO: Collapse variables when that becomes available. -->
          <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
          <label prefix=" (" suffix=")" text-case="title"/>
        </names>
        <names variable="producer">
          <!-- Producers not cited if there is a writer/director, but use if they are the principal creator. -->
          <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
          <label prefix=" (" suffix=")" text-case="title"/>
        </names>
        <choose>
          <if match="any" type="entry-dictionary entry-encyclopedia">
            <text variable="publisher"/>
          </if>
        </choose>
        <choose>
          <if match="none" variable="container-title"/>
          <else-if match="any" type="book classic entry entry-dictionary entry-encyclopedia">
            <!-- Items with a monographic \`container-title\` substitute their title and identifier, but leave description after \`container-title\`. This mimics the \`source-monographic\` macro. -->
            <text macro="author-title-substitute"/>
          </else-if>
        </choose>
        <names variable="executive-producer">
          <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
          <label prefix=" (" suffix=")" text-case="title"/>
        </names>
        <names variable="series-creator">
          <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
          <label prefix=" (" suffix=")" text-case="title"/>
        </names>
        <names variable="editor-translator"/>
        <!-- \`translator\` is not cited as a primary creator (only as Ed. & Trans.). -->
        <names variable="editor"/>
        <names variable="editorial-director"/>
        <names variable="compiler">
          <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
          <label prefix=" (" suffix=")" text-case="title"/>
        </names>
        <choose>
          <if match="any" type="event performance speech">
            <names variable="chair">
              <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
              <label prefix=" (" suffix=")" text-case="title"/>
            </names>
            <names variable="organizer">
              <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
              <label prefix=" (" suffix=")" text-case="title"/>
            </names>
          </if>
        </choose>
        <names variable="curator">
          <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
          <label prefix=" (" suffix=")" text-case="title"/>
        </names>
        <names variable="collection-editor"/>
        <choose>
          <if match="any" type="software webpage">
            <!-- \`software\` (APA 10.10) and \`webpage\` (APA 10.16) can be cited under "name of group": likely in \`publisher\` if no \`author\` -->
            <text variable="publisher"/>
          </if>
          <else-if type="standard">
            <text variable="authority"/>
          </else-if>
        </choose>
        <text macro="author-title-substitute"/>
      </substitute>
    </names>
  </macro>
  <macro name="author-and-contributors">
    <group delimiter=" ">
      <text macro="author"/>
      <choose>
        <!-- add nonprimary authors equivalent to those appearing "on a book cover"; do not modify the in-text citation (APA 9.8) -->
        <if match="none" variable="author compiler composer editor editor-translator illustrator"/>
        <else-if match="any" type="book musical_score pamphlet report standard">
          <names prefix="(" suffix=")" variable="contributor">
            <label form="verb" suffix=" "/>
            <name and="symbol" delimiter-precedes-last="always" name-as-sort-order="all"/>
          </names>
        </else-if>
      </choose>
    </group>
  </macro>
  <macro name="author-short">
    <choose>
      <if match="any" type="bill hearing legal_case legislation regulation treaty">
        <text macro="title-and-descriptions-short"/>
      </if>
      <else-if match="any" type="interview personal_communication">
        <choose>
          <!-- These variables indicate that the letter is retrievable by the reader. If not, use the APA in-text-only personal communication format. -->
          <if match="any" variable="archive archive-place container-title DOI number publisher references URL">
            <names variable="author">
              <name and="symbol" form="short"/>
              <substitute>
                <text macro="title-and-descriptions-short"/>
              </substitute>
            </names>
          </if>
          <else>
            <group delimiter=", ">
              <names variable="author">
                <name and="symbol"/>
                <substitute>
                  <text macro="title-and-descriptions-short"/>
                </substitute>
              </names>
              <text term="personal-communication"/>
            </group>
          </else>
        </choose>
      </else-if>
      <else>
        <names variable="composer">
          <name and="symbol" form="short"/>
          <substitute>
            <names variable="author"/>
            <names variable="illustrator"/>
            <choose>
              <if type="broadcast">
                <!-- TODO: Collapse variables when that becomes available. -->
                <!-- Ideally combine as \`script-writer director\` -->
                <names variable="script-writer"/>
              </if>
            </choose>
            <names variable="director"/>
            <!-- TODO: Collapse variables when that becomes available. -->
            <names variable="guest host"/>
            <names variable="producer"/>
            <choose>
              <if match="any" type="entry-dictionary entry-encyclopedia">
                <text variable="publisher"/>
              </if>
            </choose>
            <choose>
              <if match="none" variable="container-title"/>
              <else-if match="any" type="book classic entry entry-dictionary entry-encyclopedia">
                <text macro="title-and-descriptions-short"/>
              </else-if>
            </choose>
            <names variable="executive-producer"/>
            <names variable="series-creator"/>
            <names variable="editor"/>
            <names variable="editorial-director"/>
            <names variable="compiler"/>
            <choose>
              <if match="any" type="event performance speech">
                <names variable="chair"/>
                <names variable="organizer"/>
              </if>
            </choose>
            <names variable="curator"/>
            <names variable="collection-editor"/>
            <choose>
              <if match="any" type="software webpage">
                <!-- \`software\` (APA 10.10) and \`webpage\` (APA 10.16) can be cited under "name of group": likely in \`publisher\` if no \`author\` -->
                <text form="short" variable="publisher"/>
              </if>
              <else-if type="standard">
                <text form="short" variable="authority"/>
              </else-if>
            </choose>
            <text macro="title-and-descriptions-short"/>
          </substitute>
        </names>
      </else>
    </choose>
  </macro>
  <macro name="author-sort">
    <choose>
      <if match="any" type="bill hearing legal_case legislation regulation treaty">
        <text macro="legal-title"/>
      </if>
      <else>
        <text macro="author"/>
      </else>
    </choose>
  </macro>
  <!-- Author elements -->
  <macro name="author-title-substitute">
    <choose>
      <if match="any" type="review review-book" variable="reviewed-author reviewed-genre reviewed-title">
        <!-- \`title\` is only the review title if there is a separate \`reviewed-genre\` or \`reviewed-title\`; otherwise, it is the title of the reviewed work, printed in the description -->
        <choose>
          <if variable="reviewed-genre title">
            <text macro="title"/>
          </if>
          <else-if variable="reviewed-title title">
            <text macro="title"/>
          </else-if>
          <else>
            <text macro="title-and-descriptions"/>
          </else>
        </choose>
      </if>
      <else-if variable="title">
        <!-- If an item has a \`title\`, substitute missing author with title and identifier, but leave description after the date (in the title position). -->
        <group delimiter=" ">
          <text macro="title"/>
          <text macro="identifier"/>
        </group>
      </else-if>
      <else>
        <!-- If an item has no \`title\`, substitute with descriptions. -->
        <text macro="title-and-descriptions"/>
      </else>
    </choose>
  </macro>
  <!-- 2. Date (APA 9.13-17) -->
  <macro name="date">
    <!-- Full dates included for ephemeral sources (e.g. broadcasts, interviews) to provide maximum specificity, while books use year only. -->
    <group delimiter="-" prefix="(" suffix=")">
      <choose>
        <if variable="issued">
          <group delimiter=", ">
            <group>
              <text macro="date-issued-year"/>
              <text variable="year-suffix"/>
            </group>
            <choose>
              <if match="any" type="article-magazine article-newspaper broadcast collection document event motion_picture pamphlet performance personal_communication post post-weblog song speech webpage">
                <!-- Many video and audio examples in manual give full dates. Err on the side of too much information. -->
                <text macro="date-issued-month-day"/>
              </if>
              <!-- Only show the month and day for an unpublished \`interview\` or \`paper-conference\` -->
              <else-if match="any" variable="collection-editor compiler editor editorial-director issue page supplement-number volume"/>
              <else-if match="any" type="interview paper-conference">
                <text macro="date-issued-month-day"/>
              </else-if>
              <!-- Only year: article article-journal book chapter classic entry entry-dictionary entry-encyclopedia dataset figure graphic manuscript map musical_score paper-conference[published] patent periodical report review review-book software standard thesis -->
            </choose>
          </group>
        </if>
        <else-if variable="status">
          <!-- Print the status variable rather than use generic CSL terms (\`in press\`, etc.) -->
          <text text-case="lowercase" variable="status"/>
          <text variable="year-suffix"/>
        </else-if>
        <else>
          <text form="short" term="no date"/>
          <text variable="year-suffix"/>
        </else>
      </choose>
    </group>
  </macro>
  <macro name="date-short">
    <group delimiter="-">
      <choose>
        <if variable="issued">
          <group delimiter="/">
            <text macro="date-original-year"/>
            <group>
              <choose>
                <if match="any" variable="archive archive-place container-title DOI number publisher references URL">
                  <text macro="date-issued-year"/>
                </if>
                <else-if match="any" type="interview personal_communication">
                  <!-- use the in-text-only format for inaccessible personal communications -->
                  <text macro="date-issued-full"/>
                </else-if>
                <else>
                  <text macro="date-issued-year"/>
                </else>
              </choose>
              <text variable="year-suffix"/>
            </group>
          </group>
        </if>
        <else-if variable="status">
          <!-- Print the status variable rather than use generic CSL terms (\`in press\`, etc.) -->
          <text text-case="lowercase" variable="status"/>
          <text variable="year-suffix"/>
        </else-if>
        <else>
          <text form="short" term="no date"/>
          <text variable="year-suffix"/>
        </else>
      </choose>
    </group>
  </macro>
  <macro name="date-sort">
    <!-- Sort items by issue date as printed -->
    <choose>
      <if match="any" type="article article-journal book chapter entry entry-dictionary entry-encyclopedia dataset figure graphic manuscript map musical_score patent report review review-book thesis">
        <date date-parts="year" form="numeric" variable="issued"/>
      </if>
      <else-if type="paper-conference">
        <!-- Determine whether published and serial or monographic -->
        <choose>
          <if match="any" variable="collection-editor compiler editor editorial-director issue page supplement-number volume">
            <date date-parts="year" form="numeric" variable="issued"/>
          </if>
          <else>
            <text macro="date-issued-leading-zeros"/>
          </else>
        </choose>
      </else-if>
      <else>
        <text macro="date-issued-leading-zeros"/>
      </else>
    </choose>
  </macro>
  <macro name="date-sort-group">
    <!-- Sorts items with and without dates:

          1. \`no date\` items (= 0)
          2. items with dates (= 1)
          3. items with \`status\` (forthcoming, in press, etc.) (= 2) -->
    <choose>
      <if variable="issued">
        <text value="1"/>
      </if>
      <else-if variable="status">
        <text value="2"/>
      </else-if>
      <else>
        <text value="0"/>
      </else>
    </choose>
  </macro>
  <!-- Date elements -->
  <macro name="date-event-full">
    <group delimiter=" ">
      <choose>
        <if is-uncertain-date="event-date">
          <text form="short" term="circa"/>
        </if>
      </choose>
      <date form="text" variable="event-date"/>
    </group>
  </macro>
  <macro name="date-issued-full">
    <group delimiter=" ">
      <choose>
        <if is-uncertain-date="issued">
          <text form="short" term="circa"/>
        </if>
      </choose>
      <date form="text" variable="issued"/>
    </group>
  </macro>
  <macro name="date-issued-leading-zeros">
    <date delimiter="-" variable="issued">
      <date-part name="year"/>
      <date-part form="numeric-leading-zeros" name="month"/>
      <date-part form="numeric-leading-zeros" name="day"/>
    </date>
  </macro>
  <macro name="date-issued-month-day">
    <date variable="issued">
      <date-part name="month"/>
      <date-part name="day" prefix=" "/>
    </date>
  </macro>
  <macro name="date-issued-year">
    <group delimiter=" ">
      <choose>
        <if is-uncertain-date="issued">
          <text form="short" term="circa"/>
        </if>
      </choose>
      <date date-parts="year" form="numeric" variable="issued"/>
    </group>
  </macro>
  <macro name="date-original-year">
    <group delimiter=" ">
      <choose>
        <if is-uncertain-date="original-date">
          <text form="short" term="circa"/>
        </if>
      </choose>
      <date date-parts="year" form="numeric" variable="original-date"/>
    </group>
  </macro>
  <!-- 3. Title and descriptions (APA 9.18-22) -->
  <macro name="title-and-descriptions">
    <group delimiter=" ">
      <choose>
        <if variable="title">
          <text macro="title"/>
          <text macro="identifier"/>
          <text macro="description"/>
        </if>
        <else-if match="any" type="bill report">
          <!-- Bills, resolutions, and congressional reports substitute bill number if no title. -->
          <!-- Congressional reports are indistinguishable from other reports -->
          <text macro="identifier-number"/>
          <text macro="description"/>
          <text macro="identifier"/>
        </else-if>
        <else>
          <text macro="description"/>
          <text macro="identifier"/>
        </else>
      </choose>
    </group>
  </macro>
  <macro name="title-and-descriptions-short">
    <choose>
      <if variable="title">
        <text macro="title-short"/>
      </if>
      <else-if match="any" type="bill report">
        <!-- Bills, resolutions, and congressional reports substitute bill number if no title. -->
        <text macro="legal-identifier-bill-report"/>
      </else-if>
      <else>
        <text macro="description-short"/>
      </else>
    </choose>
  </macro>
  <!-- 3.1. Title (APA 9.18) -->
  <macro name="title">
    <choose>
      <if match="any" type="post webpage">
        <!-- part number/title always at the analytic level -->
        <text font-style="italic" macro="title-and-part-filter-review"/>
      </if>
      <!-- Other types are italicized based on presence of \`container-title\`. Assume that \`review\` and \`review-book\` are published either in a serial or on a webpage (APA example 69) -->
      <else-if match="any" type="article-journal article-magazine article-newspaper periodical post-weblog review review-book">
        <text macro="title-serial"/>
      </else-if>
      <else-if match="any" variable="collection-editor compiler editor editorial-director">
        <text macro="title-monographic"/>
      </else-if>
      <else-if match="any" type="interview paper-conference">
        <text macro="title-serial"/>
      </else-if>
      <else>
        <text macro="title-monographic"/>
      </else>
    </choose>
  </macro>
  <macro name="title-short">
    <choose>
      <if match="any" type="review review-book" variable="reviewed-author reviewed-genre reviewed-title">
        <!-- \`title\` is only the review title if there is a separate \`reviewed-genre\` or \`reviewed-title\`; otherwise, it is the title of the reviewed work, printed in the description -->
        <choose>
          <if variable="reviewed-genre title">
            <!-- Quotes, title case -->
            <text form="short" quotes="true" text-case="title" variable="title"/>
          </if>
          <else-if variable="reviewed-title title">
            <!-- Quotes, title case -->
            <text form="short" quotes="true" text-case="title" variable="title"/>
          </else-if>
          <else>
            <text macro="description-short"/>
          </else>
        </choose>
      </if>
      <else-if match="any" type="bill legislation regulation report treaty">
        <!-- No italics or quotes, title case -->
        <text form="short" text-case="title" variable="title"/>
      </else-if>
      <else-if match="any" type="legal_case post">
        <!-- Italicized, sentence case -->
        <text font-style="italic" form="short" variable="title"/>
      </else-if>
      <else-if match="any" type="hearing webpage">
        <!-- Italicized, title case (regardless of \`container-title\`) -->
        <text font-style="italic" form="short" text-case="title" variable="title"/>
      </else-if>
      <!-- Other types are formatted based on presence of \`container-title\`, as in title macro -->
      <else-if variable="container-title">
        <!-- Quotes, title case -->
        <text form="short" quotes="true" text-case="title" variable="title"/>
      </else-if>
      <else>
        <!-- Italicized, title case (default) -->
        <text font-style="italic" form="short" text-case="title" variable="title"/>
      </else>
    </choose>
  </macro>
  <!-- Title elements -->
  <macro name="title-and-part-filter-review">
    <choose>
      <if match="any" type="review review-book" variable="reviewed-author reviewed-genre reviewed-title">
        <!-- If a review has no \`reviewed-genre\` or \`reviewed-title\`, assume that \`title\` contains the title of the reviewed work; the description provides it. -->
        <choose>
          <if variable="reviewed-genre title">
            <text macro="title-and-part-title"/>
          </if>
          <else-if variable="reviewed-title title">
            <text macro="title-and-part-title"/>
          </else-if>
        </choose>
      </if>
      <else>
        <text macro="title-and-part-title"/>
      </else>
    </choose>
  </macro>
  <macro name="title-and-part-title">
    <group delimiter=": ">
      <text variable="title"/>
      <text macro="title-part"/>
    </group>
  </macro>
  <macro name="title-and-volume-title">
    <group delimiter=": ">
      <text variable="title"/>
      <text macro="title-volume"/>
    </group>
  </macro>
  <macro name="title-monographic">
    <!-- For monographic items, assume \`part-number\` and \`part-title\` refer to the book/volume. -->
    <choose>
      <if variable="container-title">
        <text variable="title"/>
      </if>
      <else>
        <!-- For monographic items without \`container-title\` and with \`volume-title\`, append \`volume-title\` to \`title\` (APA example 30) -->
        <text font-style="italic" macro="title-and-volume-title"/>
      </else>
    </choose>
  </macro>
  <macro name="title-part">
    <choose>
      <if variable="part-title">
        <group delimiter=". ">
          <text macro="label-part-number"/>
          <text text-case="capitalize-first" variable="part-title"/>
        </group>
      </if>
      <else-if is-numeric="part-number"/>
      <else>
        <text macro="label-part-number"/>
      </else>
    </choose>
  </macro>
  <macro name="title-serial">
    <!-- For serials, assume that \`part-number\` and \`part-title\` refer to the article and append to \`title\` -->
    <choose>
      <if variable="container-title">
        <text macro="title-and-part-filter-review"/>
      </if>
      <else>
        <!-- for serial items without \`container-title\`, don't append \`volume-title\` to \`title\` -->
        <text font-style="italic" macro="title-and-part-filter-review"/>
      </else>
    </choose>
  </macro>
  <macro name="title-volume">
    <group delimiter=", ">
      <choose>
        <!-- Assume that \`part-number\` and \`part-title\` of monographic items refer to the source book/volume -->
        <if variable="volume-title">
          <group delimiter=": ">
            <group delimiter=". ">
              <text macro="label-volume"/>
              <text variable="volume-title"/>
            </group>
            <text macro="title-part"/>
          </group>
        </if>
        <else-if variable="part-title">
          <text macro="label-volume"/>
          <text macro="title-part"/>
        </else-if>
        <!-- if there is no \`part-title\` or \`volume title\`, \`part-number\` and \`volume\` appear in \`identifier\` if numeric -->
        <else-if is-numeric="part-number volume"/>
        <else-if is-numeric="part-number" variable="volume">
          <text macro="label-volume"/>
        </else-if>
        <else-if is-numeric="volume" variable="part-number">
          <text macro="label-part-number"/>
        </else-if>
        <else-if is-numeric="part-number"/>
        <else-if is-numeric="volume"/>
        <else>
          <text macro="label-volume"/>
          <text macro="label-part-number"/>
        </else>
      </choose>
    </group>
  </macro>
  <!-- 3.2. Identifier (in parentheses) (APA 9.19) -->
  <macro name="identifier">
    <!-- (Secondary contributors; Database location; Genre no. 123; Report Series 123, Version, Edition, Volume, Page) -->
    <group delimiter="; " prefix="(" suffix=")">
      <choose>
        <if type="patent">
          <text macro="identifier-patent"/>
        </if>
        <else-if match="any" type="post webpage">
          <!-- print \`container-title\` on \`post\` or \`webpage\` in the same way as \`publisher\` -->
          <text macro="identifier-contributors"/>
          <text macro="identifier-number"/>
          <text macro="identifier-monographic"/>
        </else-if>
        <else-if type="report" variable="container-title">
          <!-- If the report is a chapter in a larger report, then most identifying information is printed in the source. -->
          <text macro="identifier-contributors"/>
        </else-if>
        <else-if type="report" variable="title">
          <text macro="identifier-contributors"/>
          <text macro="identifier-number"/>
          <text macro="identifier-monographic"/>
        </else-if>
        <else-if type="report">
          <!-- If there is no \`title\`, then \`genre\` and \`number\` are already printed as the title. -->
          <text macro="identifier-contributors"/>
          <text macro="identifier-monographic"/>
        </else-if>
        <else-if variable="container-title">
          <choose>
            <if match="none" variable="genre title">
              <text macro="label-chapter-number"/>
            </if>
          </choose>
          <text macro="identifier-contributors"/>
          <choose>
            <if match="any" type="broadcast graphic map motion_picture">
              <!-- For some audiovisual media, \`number\` information comes after title, not \`container-title\` (APA example 94); but an album track number is \`chapter-number\` -->
              <text macro="identifier-number"/>
            </if>
          </choose>
          <text macro="identifier-serial"/>
        </else-if>
        <else>
          <text macro="identifier-contributors"/>
          <text macro="identifier-number"/>
          <text macro="identifier-monographic"/>
          <text macro="identifier-serial"/>
        </else>
      </choose>
    </group>
  </macro>
  <!-- Identifier elements -->
  <macro name="identifier-contributors">
    <choose>
      <if match="any" type="article-journal article-magazine article-newspaper periodical post-weblog review review-book">
        <text macro="identifier-contributors-serial"/>
      </if>
      <else-if match="any" variable="collection-editor compiler editor editorial-director">
        <text macro="identifier-contributors-monographic"/>
      </else-if>
      <else-if match="any" type="interview paper-conference">
        <text macro="identifier-contributors-serial"/>
      </else-if>
      <else>
        <text macro="identifier-contributors-monographic"/>
      </else>
    </choose>
  </macro>
  <macro name="identifier-contributors-monographic">
    <group delimiter="; ">
      <choose>
        <if variable="title">
          <names variable="interviewer">
            <name and="symbol"/>
            <label form="short" prefix=", " text-case="title"/>
          </names>
        </if>
      </choose>
      <choose>
        <if match="any" type="post webpage">
          <!-- print \`container-title\` on \`post\` or \`webpage\` in the same way as \`publisher\` -->
          <names variable="container-author">
            <label form="verb-short" suffix=" " text-case="title"/>
            <name and="symbol"/>
          </names>
          <names delimiter="; " variable="editor translator">
            <name and="symbol"/>
            <label form="short" prefix=", " text-case="title"/>
          </names>
          <names delimiter="; " variable="illustrator narrator">
            <name and="symbol"/>
            <label form="short" prefix=", " text-case="title"/>
          </names>
          <names delimiter="; " variable="compiler chair organizer curator series-creator executive-producer">
            <name and="symbol"/>
            <label prefix=", " text-case="title"/>
          </names>
        </if>
        <else>
          <names delimiter="; " variable="illustrator narrator">
            <name and="symbol"/>
            <label form="short" prefix=", " text-case="title"/>
          </names>
          <choose>
            <if variable="container-title editor-translator"/>
            <else-if variable="container-title">
              <!-- TODO: Check logic once processors start to automatically populate \`editor-translator\` -->
              <names delimiter="; " variable="translator">
                <name and="symbol"/>
                <label form="short" prefix=", " text-case="title"/>
              </names>
            </else-if>
            <else>
              <names variable="container-author">
                <label form="verb-short" suffix=" " text-case="title"/>
                <name and="symbol"/>
              </names>
              <names delimiter="; " variable="editor translator">
                <name and="symbol"/>
                <label form="short" prefix=", " text-case="title"/>
              </names>
              <names delimiter="; " variable="compiler chair organizer curator series-creator executive-producer">
                <name and="symbol"/>
                <label prefix=", " text-case="title"/>
              </names>
            </else>
          </choose>
        </else>
      </choose>
    </group>
  </macro>
  <macro name="identifier-contributors-serial">
    <group delimiter="; ">
      <choose>
        <if variable="title">
          <names delimiter="; " variable="interviewer">
            <name and="symbol"/>
            <label form="short" prefix=", " text-case="title"/>
          </names>
        </if>
      </choose>
      <names delimiter="; " variable="translator narrator">
        <name and="symbol"/>
        <label form="short" prefix=", " text-case="title"/>
      </names>
    </group>
  </macro>
  <macro name="identifier-locators">
    <choose>
      <if variable="page">
        <text macro="label-page"/>
      </if>
      <else-if variable="chapter-number genre">
        <text macro="label-chapter-number"/>
      </else-if>
      <else-if variable="chapter-number title">
        <text macro="label-chapter-number"/>
      </else-if>
      <!-- \`chapter-number\` appears earlier in \`identifier\` if there is no \`title\` or \`genre\` -->
    </choose>
  </macro>
  <macro name="identifier-monographic">
    <choose>
      <!-- omit serial types -->
      <if match="any" type="article-journal article-magazine article-newspaper broadcast event patent performance periodical post post-weblog review review-book speech webpage"/>
      <else-if match="any" variable="collection-editor compiler editor editorial-director">
        <!-- monographic types -->
        <text macro="identifier-monographic-item"/>
      </else-if>
      <!-- omit serial types -->
      <else-if match="any" type="interview paper-conference"/>
      <else>
        <!-- monographic types -->
        <text macro="identifier-monographic-item"/>
      </else>
    </choose>
  </macro>
  <macro name="identifier-monographic-item">
    <group delimiter=", ">
      <text macro="label-version"/>
      <text macro="label-edition"/>
      <text macro="identifier-series"/>
      <text macro="label-supplement-number"/>
      <text macro="identifier-number-volume"/>
      <text macro="identifier-number-part"/>
      <text macro="label-issue"/>
      <text macro="identifier-locators"/>
    </group>
  </macro>
  <macro name="identifier-number">
    <group delimiter=" ">
      <choose>
        <if type="thesis" variable="genre">
          <!-- \`genre\` provided with thesis description (APA example 65) -->
          <text text-case="capitalize-first" value="publication"/>
        </if>
        <else-if variable="number">
          <text text-case="title" variable="genre"/>
        </else-if>
      </choose>
      <text macro="label-number"/>
    </group>
  </macro>
  <macro name="identifier-number-part">
    <choose>
      <!-- Part number printed with part title -->
      <if variable="part-title"/>
      <!-- Non-numeric part numbers printed as part of the title -->
      <else-if is-numeric="part-number">
        <text macro="label-part-number"/>
      </else-if>
    </choose>
  </macro>
  <macro name="identifier-number-volume">
    <choose>
      <!-- Volume number printed with volume/part title -->
      <if variable="volume volume-title"/>
      <else-if variable="part-title volume"/>
      <!-- Non-numeric volumes printed as part of the book title -->
      <else-if is-numeric="volume">
        <text macro="label-volume"/>
      </else-if>
      <else>
        <text macro="label-number-of-volumes"/>
      </else>
    </choose>
  </macro>
  <macro name="identifier-patent">
    <!-- \`authority\`: U.S. ; \`genre\`: patent ; \`number\`: 123,445 -->
    <group delimiter=" ">
      <text form="short" variable="authority"/>
      <choose>
        <if variable="genre">
          <text text-case="capitalize-first" variable="genre"/>
        </if>
        <else>
          <text term="patent" text-case="capitalize-first"/>
        </else>
      </choose>
      <text macro="label-number"/>
    </group>
  </macro>
  <macro name="identifier-serial">
    <choose>
      <if match="any" type="article-journal article-magazine article-newspaper periodical post-weblog review review-book">
        <!-- serial types -->
        <text macro="identifier-number-part"/>
      </if>
      <!-- omit monographic types -->
      <else-if match="any" variable="collection-editor compiler editor editorial-director"/>
      <else-if match="any" type="interview paper-conference">
        <!-- serial types -->
        <text macro="identifier-number-part"/>
      </else-if>
    </choose>
  </macro>
  <macro name="identifier-series">
    <!-- Series given only for report-like types (APA example 52) -->
    <choose>
      <if match="any" type="document report standard">
        <group delimiter=" ">
          <text text-case="title" variable="collection-title"/>
          <text variable="collection-number"/>
        </group>
      </if>
    </choose>
  </macro>
  <!-- 3.3. Description [in square brackets] (APA 9.21) -->
  <macro name="description">
    <group prefix="[" suffix="]">
      <choose>
        <if match="any" type="interview" variable="interviewer">
          <text macro="description-interview"/>
        </if>
        <else-if match="any" type="review review-book" variable="reviewed-author reviewed-genre reviewed-title">
          <text macro="description-review"/>
        </else-if>
        <else-if type="personal_communication">
          <text macro="description-letter"/>
        </else-if>
        <else-if type="song" variable="composer">
          <text macro="description-song"/>
        </else-if>
        <else-if type="thesis">
          <text macro="description-thesis"/>
        </else-if>
        <else-if match="any" type="article-journal article-magazine article-newspaper periodical post-weblog review review-book">
          <text macro="description-serial"/>
        </else-if>
        <else-if match="none" variable="container-title">
          <!-- Other description -->
          <text macro="description-format"/>
        </else-if>
        <!-- For unpublished conference presentations/performances/events, chapters in reports/standards/generic documents, software, place description within the source element -->
        <else-if match="any" type="document report software standard"/>
        <else-if match="any" type="event paper-conference performance speech">
          <choose>
            <if match="any" variable="collection-editor compiler editor editorial-director issue page supplement-number volume">
              <text macro="description-format"/>
            </if>
          </choose>
        </else-if>
        <else>
          <text macro="description-format"/>
        </else>
      </choose>
    </group>
  </macro>
  <macro name="description-short">
    <group prefix="[" suffix="]">
      <choose>
        <if match="any" type="interview" variable="interviewer">
          <text macro="description-interview-short"/>
        </if>
        <else-if match="any" type="review review-book" variable="reviewed-author reviewed-genre reviewed-title">
          <text macro="description-review-short"/>
        </else-if>
        <else-if type="personal_communication">
          <text macro="description-letter-short"/>
        </else-if>
        <else-if match="any" type="article-journal article-magazine article-newspaper periodical post-weblog review review-book">
          <!-- serial types -->
          <text macro="description-serial-short"/>
        </else-if>
        <else-if match="any" variable="collection-editor compiler editor editorial-director">
          <!-- monographic types -->
          <text macro="description-format-short"/>
        </else-if>
        <else-if match="any" type="interview paper-conference">
          <!-- serial types -->
          <text macro="description-serial-short"/>
        </else-if>
        <else>
          <!-- monographic types -->
          <text macro="description-format-short"/>
        </else>
      </choose>
    </group>
  </macro>
  <!-- Description elements -->
  <macro name="description-format">
    <choose>
      <if match="any" variable="genre medium">
        <group delimiter="; ">
          <choose>
            <if match="none" variable="number">
              <text text-case="capitalize-first" variable="genre"/>
            </if>
          </choose>
          <text text-case="capitalize-first" variable="medium"/>
        </group>
      </if>
      <else>
        <text macro="description-format-term-generic"/>
      </else>
    </choose>
  </macro>
  <macro name="description-format-short">
    <choose>
      <if variable="genre">
        <text form="short" text-case="capitalize-first" variable="genre"/>
      </if>
      <else-if variable="medium">
        <text form="short" text-case="capitalize-first" variable="medium"/>
      </else-if>
      <else>
        <text macro="description-format-term-generic"/>
      </else>
    </choose>
  </macro>
  <macro name="description-format-term-generic">
    <!-- Generic labels for specific types -->
    <choose>
      <if type="broadcast">
        <text term="broadcast" text-case="capitalize-first"/>
      </if>
      <else-if type="collection">
        <text term="collection" text-case="capitalize-first"/>
      </else-if>
      <else-if type="dataset">
        <text term="dataset" text-case="capitalize-first"/>
      </else-if>
      <else-if type="figure">
        <text term="figure" text-case="capitalize-first"/>
      </else-if>
      <else-if type="graphic">
        <text term="graphic" text-case="capitalize-first"/>
      </else-if>
      <else-if match="any" type="interview personal_communication">
        <choose>
          <if match="none" variable="archive archive-place container-title DOI number publisher references URL">
            <text term="personal-communication" text-case="capitalize-first"/>
          </if>
          <else-if type="interview">
            <text term="interview" text-case="capitalize-first"/>
          </else-if>
          <else-if type="personal_communication">
            <text term="letter" text-case="capitalize-first"/>
          </else-if>
        </choose>
      </else-if>
      <else-if type="manuscript">
        <choose>
          <if match="none" variable="archive archive-place container-title DOI number publisher references URL">
            <text term="manuscript" text-case="capitalize-first"/>
          </if>
        </choose>
      </else-if>
      <else-if type="map">
        <text term="map" text-case="capitalize-first"/>
      </else-if>
      <else-if type="motion_picture">
        <text term="motion_picture" text-case="capitalize-first"/>
      </else-if>
      <else-if type="periodical" variable="container-title supplement-number">
        <text term="supplement" text-case="capitalize-first"/>
      </else-if>
      <else-if type="periodical" variable="container-title title">
        <text term="special-issue" text-case="capitalize-first"/>
      </else-if>
      <else-if type="song">
        <text term="song" text-case="capitalize-first"/>
      </else-if>
      <else-if type="software">
        <text term="software" text-case="capitalize-first"/>
      </else-if>
      <else-if type="post">
        <text term="post" text-case="capitalize-first"/>
      </else-if>
      <else-if type="review">
        <text term="review" text-case="capitalize-first"/>
      </else-if>
      <else-if type="review-book">
        <text term="review-book" text-case="capitalize-first"/>
      </else-if>
    </choose>
  </macro>
  <macro name="description-interview">
    <group delimiter="; ">
      <choose>
        <if variable="interviewer title">
          <!-- Avoid repeating 'interview' -->
          <choose>
            <if match="none" variable="number">
              <text text-case="capitalize-first" variable="genre"/>
            </if>
          </choose>
          <text text-case="capitalize-first" variable="medium"/>
        </if>
        <else-if variable="title">
          <text macro="description-format"/>
        </else-if>
        <else-if variable="genre">
          <group delimiter=" ">
            <text text-case="capitalize-first" variable="genre"/>
            <choose>
              <if variable="interviewer">
                <text form="verb" term="container-author"/>
                <names variable="interviewer">
                  <name and="symbol"/>
                </names>
              </if>
            </choose>
          </group>
        </else-if>
        <else-if variable="interviewer">
          <names variable="interviewer">
            <label form="verb" suffix=" " text-case="capitalize-first"/>
            <name and="symbol"/>
          </names>
          <text text-case="capitalize-first" variable="medium"/>
        </else-if>
        <else>
          <text macro="description-format"/>
        </else>
      </choose>
    </group>
  </macro>
  <macro name="description-interview-short">
    <names variable="interviewer">
      <label form="verb" suffix=" " text-case="capitalize-first"/>
      <name and="symbol" form="short"/>
      <substitute>
        <text macro="description-format-short"/>
      </substitute>
    </names>
  </macro>
  <macro name="description-letter">
    <choose>
      <if variable="recipient">
        <group delimiter="; ">
          <group delimiter=" ">
            <text macro="description-format"/>
            <names variable="recipient">
              <label form="verb" suffix=" "/>
              <name and="symbol" initialize="false"/>
            </names>
          </group>
          <text macro="description-medium"/>
        </group>
      </if>
      <else>
        <text macro="description-format"/>
      </else>
    </choose>
  </macro>
  <macro name="description-letter-short">
    <choose>
      <if variable="recipient">
        <group delimiter=" ">
          <text macro="description-format-short"/>
          <names variable="recipient">
            <label form="verb" suffix=" "/>
            <name and="symbol" form="short"/>
          </names>
        </group>
      </if>
      <else>
        <text macro="description-format-short"/>
      </else>
    </choose>
  </macro>
  <macro name="description-medium">
    <choose>
      <if variable="number"/>
      <else-if variable="genre">
        <text text-case="capitalize-first" variable="medium"/>
      </else-if>
    </choose>
  </macro>
  <macro name="description-review">
    <group delimiter="; ">
      <group delimiter=", ">
        <group delimiter=" ">
          <choose>
            <if variable="reviewed-genre">
              <text term="review-of" text-case="capitalize-first"/>
              <text variable="reviewed-genre"/>
            </if>
            <else-if variable="number">
              <!-- Genre printed with \`number\` -->
              <text form="short" term="review-of" text-case="capitalize-first"/>
            </else-if>
            <!-- If no \`reviewed-genre\`, assume that \`genre\` or \`medium\` is entered as 'Review of the book' or similar -->
            <else-if variable="genre">
              <text text-case="capitalize-first" variable="genre"/>
            </else-if>
            <else-if variable="medium">
              <text text-case="capitalize-first" variable="medium"/>
            </else-if>
            <else-if type="review-book">
              <text term="review-of" text-case="capitalize-first"/>
              <text term="book" text-case="lowercase"/>
            </else-if>
            <else>
              <text form="short" term="review-of" text-case="capitalize-first"/>
            </else>
          </choose>
          <text macro="description-review-title"/>
        </group>
        <names variable="reviewed-author">
          <label form="verb-short" suffix=" "/>
          <name and="symbol"/>
        </names>
      </group>
      <text macro="description-medium"/>
    </group>
  </macro>
  <macro name="description-review-short">
    <group delimiter=" ">
      <text form="short" term="review-of" text-case="capitalize-first"/>
      <text macro="description-review-title-short"/>
    </group>
  </macro>
  <macro name="description-review-title">
    <choose>
      <if match="any" variable="reviewed-genre reviewed-title">
        <!-- Not possible to distinguish TV series episode from other reviewed works without a reviewed source title (APA example 69) -->
        <!-- TODO: Adapt for \`reviewed-container-title\` or similar if it becomes available -->
        <text font-style="italic" variable="reviewed-title"/>
      </if>
      <else>
        <!-- Assume \`title\` is the title of the reviewed work -->
        <text font-style="italic" variable="title"/>
      </else>
    </choose>
  </macro>
  <macro name="description-review-title-short">
    <choose>
      <if match="any" variable="reviewed-genre reviewed-title">
        <!-- Not possible to distinguish TV series episode from other reviewed works without a reviewed source title (APA example 69) -->
        <!-- TODO: Adapt for \`reviewed-container-title\` or similar if it becomes available -->
        <text font-style="italic" form="short" text-case="title" variable="reviewed-title"/>
      </if>
      <else>
        <!-- Assume \`title\` is the title of the reviewed work -->
        <text font-style="italic" form="short" text-case="title" variable="title"/>
      </else>
    </choose>
  </macro>
  <macro name="description-serial">
    <group delimiter="; ">
      <text macro="description-format"/>
      <choose>
        <if match="none" variable="title">
          <text variable="section"/>
        </if>
      </choose>
    </group>
  </macro>
  <macro name="description-serial-short">
    <choose>
      <if variable="title"/>
      <else-if variable="section">
        <text form="short" text-case="capitalize-first" variable="section"/>
      </else-if>
      <else>
        <text macro="description-format-short"/>
      </else>
    </choose>
  </macro>
  <macro name="description-song">
    <!-- Performer of classical music works -->
    <group delimiter="; ">
      <group delimiter=" ">
        <!-- Based on \`description-format\` macro -->
        <choose>
          <if match="any" variable="genre medium">
            <choose>
              <if match="none" variable="number">
                <text text-case="capitalize-first" variable="genre"/>
              </if>
            </choose>
            <text text-case="capitalize-first" variable="medium"/>
            <text form="verb" term="performer"/>
          </if>
          <else>
            <text form="verb" term="performer" text-case="capitalize-first"/>
          </else>
        </choose>
        <names variable="author">
          <name and="symbol"/>
          <substitute>
            <names variable="performer"/>
          </substitute>
        </names>
      </group>
      <text macro="description-medium"/>
    </group>
  </macro>
  <macro name="description-thesis">
    <group delimiter="; ">
      <group delimiter=", ">
        <text text-case="capitalize-first" variable="genre"/>
        <choose>
          <if match="any" variable="archive DOI URL">
            <!-- Include the university in description if thesis is published -->
            <text variable="publisher"/>
          </if>
        </choose>
      </group>
      <text text-case="capitalize-first" variable="medium"/>
    </group>
  </macro>
  <!-- 4. Source (APA 9.23-37) -->
  <macro name="source">
    <group delimiter=". ">
      <choose>
        <if match="any" type="post webpage"/>
        <else-if match="any" type="article-journal article-magazine article-newspaper periodical post-weblog review review-book">
          <text macro="source-serial"/>
        </else-if>
        <else-if match="any" variable="collection-editor compiler editor editorial-director">
          <text macro="source-monographic"/>
        </else-if>
        <else-if match="any" type="interview paper-conference">
          <text macro="source-serial"/>
        </else-if>
        <else>
          <text macro="source-monographic"/>
        </else>
      </choose>
      <text macro="source-publisher"/>
      <text macro="source-archive"/>
      <text macro="source-location"/>
      <text macro="source-website"/>
    </group>
  </macro>
  <!-- 4.1. Serial sources (APA 9.25-27) -->
  <macro name="source-serial">
    <group delimiter=". ">
      <group delimiter=", ">
        <group delimiter=", " font-style="italic">
          <text text-case="title" variable="container-title"/>
          <!-- \`collection-title\` is for any serial with multiple series (e.g. 'second series') -->
          <text text-case="title" variable="collection-title"/>
        </group>
        <group>
          <text font-style="italic" variable="volume"/>
          <group delimiter=", " prefix="(" suffix=")">
            <text variable="issue"/>
            <text macro="label-supplement-number"/>
          </group>
        </group>
        <choose>
          <if variable="number">
            <text macro="label-number-article"/>
          </if>
          <else>
            <text variable="page"/>
          </else>
        </choose>
      </group>
      <choose>
        <if match="any" variable="collection-title issue number page supplement-number volume"/>
        <else-if variable="issued status">
          <!-- Print the status variable rather than use generic CSL terms (\`in press\`, etc.) -->
          <text text-case="capitalize-first" variable="status"/>
        </else-if>
      </choose>
    </group>
  </macro>
  <!-- 4.2. Monographic sources (APA 9.28) -->
  <macro name="source-monographic">
    <!-- Monographic sources repeat main reference elements -->
    <choose>
      <if variable="container-title">
        <group delimiter=" ">
          <choose>
            <if type="song">
              <text term="on" text-case="capitalize-first"/>
            </if>
            <else>
              <text term="in" text-case="capitalize-first"/>
            </else>
          </choose>
          <group delimiter=", ">
            <text macro="source-monographic-author"/>
            <text macro="source-monographic-title"/>
          </group>
          <text macro="source-monographic-identifier"/>
          <text macro="source-monographic-description"/>
        </group>
      </if>
    </choose>
  </macro>
  <!-- Monographic source author -->
  <macro name="source-monographic-author">
    <names variable="container-author">
      <name and="symbol"/>
      <label prefix=" (" suffix=")" text-case="title"/>
      <substitute>
        <names variable="executive-producer"/>
        <names variable="series-creator"/>
        <names variable="editor-translator">
          <name and="symbol"/>
          <label form="short" prefix=" (" suffix=")" text-case="title"/>
        </names>
        <!-- TODO: Translator omitted on the assumption that editor-translators are uncommon for chapter citations. If needed, direct entry or automatic population of \`editor-translator\` can produce combined labels. -->
        <names delimiter="; " variable="editor">
          <name and="symbol"/>
          <label form="short" prefix=" (" suffix=")" text-case="title"/>
        </names>
        <names variable="editorial-director">
          <name and="symbol"/>
          <label form="short" prefix=" (" suffix=")" text-case="title"/>
        </names>
        <names variable="compiler"/>
        <choose>
          <if match="any" type="event performance speech">
            <names variable="chair"/>
            <names variable="organizer"/>
          </if>
        </choose>
        <names variable="curator"/>
        <names variable="collection-editor">
          <name and="symbol"/>
          <label form="short" prefix=" (" suffix=")" text-case="title"/>
        </names>
      </substitute>
    </names>
  </macro>
  <!-- Monographic source title -->
  <macro name="source-monographic-title">
    <group delimiter=": " font-style="italic">
      <text variable="container-title"/>
      <text macro="title-volume"/>
    </group>
  </macro>
  <!-- Monographic source identifier -->
  <macro name="source-monographic-identifier">
    <choose>
      <if variable="container-title">
        <group delimiter="; " prefix="(" suffix=")">
          <choose>
            <if match="none" type="broadcast graphic map motion_picture">
              <!-- For some audiovisual media, number information comes after \`title\`, not \`container-title\` (APA example 94); but an album track number is \`chapter-number\` -->
              <text macro="identifier-number"/>
            </if>
          </choose>
          <text macro="identifier-monographic"/>
        </group>
      </if>
    </choose>
  </macro>
  <!-- Monographic source description -->
  <macro name="source-monographic-description">
    <group prefix="[" suffix="]">
      <choose>
        <if match="any" type="document report software standard">
          <!-- place description after \`container-title\` -->
          <text macro="description-format"/>
        </if>
        <else-if match="any" variable="collection-editor compiler editor editorial-director issue page supplement-number volume"/>
        <else-if match="any" type="event paper-conference performance speech">
          <!-- unpublished conference presentations should describe the session -->
          <text macro="description-format"/>
        </else-if>
      </choose>
    </group>
  </macro>
  <!-- 4.3. Publisher sources (APA 9.29) -->
  <macro name="source-publisher">
    <choose>
      <if type="thesis">
        <choose>
          <if match="none" variable="archive DOI URL">
            <!-- Provide university in \`publisher\` if unpublished -->
            <text variable="publisher"/>
          </if>
        </choose>
      </if>
      <!-- omit serial types -->
      <else-if match="any" type="article-journal article-magazine article-newspaper periodical post-weblog review review-book"/>
      <else-if match="any" variable="collection-editor compiler editor editorial-director">
        <!-- monographic types -->
        <text variable="publisher"/>
      </else-if>
      <else-if type="interview">
        <!-- give publisher for a broadcast \`interview\` handled as a serial type -->
        <text variable="publisher"/>
      </else-if>
      <!-- omit serial \`paper-conference\` -->
      <else-if type="paper-conference"/>
      <else>
        <text variable="publisher"/>
      </else>
    </choose>
  </macro>
  <!-- 4.4. Database and archive sources (APA 9.30) -->
  <macro name="source-archive">
    <group delimiter=", ">
      <choose>
        <if variable="archive_collection">
          <!-- With collection: \`archive_collection\` (\`archive_location\`), \`archive\`, \`archive-place\` -->
          <group delimiter=" ">
            <text variable="archive_collection"/>
            <text prefix="(" suffix=")" variable="archive_location"/>
          </group>
          <text variable="archive"/>
          <text variable="archive-place"/>
        </if>
        <else>
          <!-- No collection: \`archive\` (\`archive_location\`), \`archive-place\` -->
          <group delimiter=" ">
            <text variable="archive"/>
            <text prefix="(" suffix=")" variable="archive_location"/>
          </group>
          <text variable="archive-place"/>
        </else>
      </choose>
      <!-- a database identifier/number is stored in \`number\` and appears in \`identifier-number\` -->
    </group>
  </macro>
  <!-- 4.5. Works with specific locations (APA 9.31) -->
  <macro name="source-location">
    <choose>
      <if match="any" variable="event event-title">
        <!-- TODO: To prevent Zotero from printing \`event-place\`, due to its double-mapping of \`publisher-place\` and \`event-place\`. Remove this when that is changed. -->
        <choose>
          <if type="paper-conference">
            <choose>
              <if match="none" variable="collection-editor compiler editor editorial-director issue page supplement-number volume">
                <!-- Don't print event info for conference papers published in a proceedings -->
                <text macro="source-location-title-place-date"/>
              </if>
            </choose>
          </if>
          <else>
            <!-- For other item types, print event info even if published (e.g. collection catalogs, performance programs). These items aren't given explicit examples in the APA manual, so err on the side of providing too much information. -->
            <text macro="source-location-title-place-date"/>
          </else>
        </choose>
      </if>
    </choose>
  </macro>
  <macro name="source-location-title-place-date">
    <group delimiter=", ">
      <choose>
        <!-- TODO: We expect \`event-title\` to be used, but processors and applications may not be updated yet. This macro ensures that either \`event\` or \`event-title\` can be accepted. Remove if processor logic and application adoption can handle this. -->
        <if variable="event-title">
          <text text-case="capitalize-first" variable="event-title"/>
        </if>
        <else>
          <text text-case="capitalize-first" variable="event"/>
        </else>
      </choose>
      <text variable="event-place"/>
      <text macro="date-event-full"/>
    </group>
  </macro>
  <!-- 4.6. Social media and website sources (APA 9.32-33) -->
  <macro name="source-website">
    <choose>
      <if match="any" type="post webpage">
        <text text-case="title" variable="container-title"/>
      </if>
    </choose>
  </macro>
  <!-- 4.7. DOI or URL (APA 9.34-36) -->
  <macro name="source-DOI-URL">
    <choose>
      <if variable="DOI">
        <text prefix="https://doi.org/" variable="DOI"/>
      </if>
      <else-if variable="URL">
        <group delimiter=" ">
          <choose>
            <if match="none" variable="issued status">
              <text term="retrieved" text-case="capitalize-first"/>
              <group delimiter=", ">
                <date form="text" variable="accessed"/>
                <text term="from"/>
              </group>
            </if>
          </choose>
          <text variable="URL"/>
        </group>
      </else-if>
    </choose>
  </macro>
  <!-- 5. Publication history (APA 9.39-41) -->
  <macro name="publication-history">
    <!-- Notes on source element: original publication, reprint info, retraction info -->
    <group delimiter="; " prefix="(" suffix=")">
      <choose>
        <if type="patent">
          <text variable="references"/>
        </if>
        <else>
          <!-- Print \`status\` here for "retracted" etc. if it's not printed elsewhere. -->
          <choose>
            <if match="none" variable="issued"/>
            <else-if match="any" variable="collection-title issue number page supplement-number volume">
              <text text-case="capitalize-first" variable="status"/>
            </else-if>
          </choose>
          <choose>
            <if variable="references">
              <!-- Provide the option for more elaborate description of publication history, such as full "reprinted" references (APA examples 11, 43, 44) -->
              <text variable="references"/>
            </if>
            <else>
              <!-- Format publication history using CSL variables -->
              <group delimiter=" ">
                <text term="original-work-published" text-case="capitalize-first"/>
                <group delimiter=", ">
                  <group delimiter=" ">
                    <text value="as"/>
                    <text font-style="italic" variable="original-title"/>
                  </group>
                  <text macro="date-original-year"/>
                  <text variable="original-publisher"/>
                </group>
              </group>
            </else>
          </choose>
        </else>
      </choose>
    </group>
  </macro>
  <!-- 6. Legal references: Bluebook style (shared with Chicago) -->
  <!-- Where APA or Chicago diverge from Bluebook, the official manual is followed -->
  <macro name="legal-reference">
    <!-- Type usage:

         \`bill\`
         : bills, resolutions, federal reports

         \`legal_case\`
         : all legal and court cases

         \`hearing\`
         : hearings and testimony

         \`legislation\`
         : statutes, constitutional items, and charters

         \`regulation\`
         : codified regulations, uncodified regulations, executive orders

         \`treaty\`
         : treaties
    -->
    <group delimiter=", ">
      <choose>
        <if type="treaty">
          <text macro="legal-title"/>
          <names variable="author">
            <!-- Treaty parties should be included at least for bilateral treaties (Bluebook 21.4.2) -->
            <name delimiter="-" et-al-min="100" et-al-use-first="99" form="short" initialize="false"/>
          </names>
          <text macro="legal-date"/>
          <!-- treaty source/report in addition to URL (Bluebook 21.4.5) -->
          <text macro="legal-source"/>
        </if>
        <else>
          <group delimiter=" ">
            <group delimiter=", ">
              <text macro="legal-title"/>
              <text macro="legal-source"/>
            </group>
            <text macro="legal-date"/>
            <text macro="legal-identifier"/>
          </group>
        </else>
      </choose>
      <group delimiter=" ">
        <!-- locator for use in notes -->
        <choose>
          <if locator="page" variable="page">
            <text term="at"/>
          </if>
        </choose>
        <text macro="label-locator"/>
      </group>
    </group>
  </macro>
  <!-- 6.1. Legal date -->
  <macro name="legal-date">
    <choose>
      <if type="treaty">
        <text macro="date-issued-full"/>
      </if>
      <else-if type="legal_case">
        <text macro="legal-date-case"/>
      </else-if>
      <else-if match="any" type="bill hearing legislation regulation">
        <group delimiter=" " prefix="(" suffix=")">
          <group delimiter=" ">
            <text macro="date-original-year"/>
            <text form="symbol" term="and"/>
          </group>
          <choose>
            <if variable="issued">
              <text macro="date-issued-year"/>
            </if>
            <else>
              <!-- Show proposal date for uncodified regulations. Assume date is entered literally ala "proposed May 23, 2016". -->
              <!-- TODO: Add \`proposed\` date here if that becomes available -->
              <date form="text" variable="submitted"/>
            </else>
          </choose>
        </group>
      </else-if>
    </choose>
  </macro>
  <macro name="legal-date-case">
    <group delimiter=" " prefix="(" suffix=")">
      <text variable="authority"/>
      <choose>
        <if variable="container-title">
          <!-- Print only year for cases published in reporters-->
          <text macro="date-issued-year"/>
        </if>
        <else>
          <text macro="date-issued-full"/>
        </else>
      </choose>
    </group>
  </macro>
  <!-- 6.2.1. Legal title -->
  <macro name="legal-title">
    <choose>
      <if match="any" type="bill legal_case legislation regulation treaty">
        <text text-case="title" variable="title"/>
      </if>
      <else-if type="hearing">
        <!-- use standard format (Bluebook 13.3) -->
        <group delimiter=": " font-style="italic">
          <text text-case="capitalize-first" variable="title"/>
          <group delimiter=" ">
            <text term="hearing" text-case="capitalize-first"/>
            <group delimiter=" ">
              <text term="on"/>
              <text variable="number"/>
            </group>
            <group delimiter=" ">
              <text value="before the"/>
              <text variable="section"/>
            </group>
          </group>
        </group>
      </else-if>
    </choose>
  </macro>
  <!-- 6.2.2. Legal identifier -->
  <macro name="legal-identifier">
    <group delimiter=" " prefix="(" suffix=")">
      <choose>
        <if type="hearing">
          <!-- Use the 'verb' form of the hearing term to hold 'testimony of' -->
          <text form="verb" term="hearing"/>
          <names variable="author">
            <name and="symbol" initialize="false"/>
          </names>
        </if>
        <else-if match="any" type="bill legislation regulation">
          <!-- For uncodified regulations, assume future code section is in \`status\`. -->
          <text variable="status"/>
        </else-if>
      </choose>
    </group>
  </macro>
  <macro name="legal-identifier-bill-report">
    <group delimiter=" ">
      <text variable="genre"/>
      <choose>
        <if match="any" variable="authority chapter-number container-title">
          <text variable="number"/>
        </if>
        <else>
          <!-- If there is no legislative body, session number, or code/record title, assume the item is a congressional report and include 'No.' label. -->
          <text macro="label-number-capitalized"/>
        </else>
      </choose>
    </group>
  </macro>
  <!-- 6.3. Legal source -->
  <macro name="legal-source">
    <!-- Expect legal item \`container-title\` to be stored in short form -->
    <choose>
      <if type="bill">
        <text macro="legal-source-bill"/>
      </if>
      <else-if type="hearing">
        <text macro="legal-source-hearing"/>
      </else-if>
      <else-if type="legal_case">
        <text macro="legal-source-case"/>
      </else-if>
      <else-if type="legislation">
        <text macro="legal-source-legislation"/>
      </else-if>
      <else-if type="regulation">
        <text macro="legal-source-regulation"/>
      </else-if>
      <else-if type="treaty">
        <text macro="legal-source-treaty"/>
      </else-if>
    </choose>
  </macro>
  <!-- Legal source types -->
  <macro name="legal-source-bill">
    <group delimiter=", ">
      <text macro="legal-identifier-bill-report"/>
      <group delimiter=" ">
        <text variable="authority"/>
        <!-- \`chapter-number\` is a session number -->
        <text variable="chapter-number"/>
      </group>
      <group delimiter=" ">
        <text variable="volume"/>
        <text variable="container-title"/>
        <text variable="page-first"/>
      </group>
    </group>
  </macro>
  <macro name="legal-source-case">
    <group delimiter=" ">
      <choose>
        <if variable="container-title">
          <text variable="volume"/>
          <text variable="container-title"/>
          <text macro="label-section-symbol"/>
          <choose>
            <if match="any" variable="page page-first">
              <text variable="page-first"/>
            </if>
            <else>
              <text value="___"/>
            </else>
          </choose>
        </if>
        <else>
          <text macro="label-number-capitalized"/>
        </else>
      </choose>
    </group>
  </macro>
  <macro name="legal-source-hearing">
    <group delimiter=" ">
      <text variable="authority"/>
      <!-- \`chapter-number\` is a session number -->
      <text variable="chapter-number"/>
    </group>
  </macro>
  <macro name="legal-source-legislation">
    <choose>
      <if variable="number">
        <!-- \`number\` is a public law number -->
        <group delimiter=", ">
          <group delimiter=" ">
            <choose>
              <if variable="genre">
                <text text-case="capitalize-first" variable="genre"/>
              </if>
              <else>
                <text form="short" term="legislation" text-case="capitalize-first"/>
              </else>
            </choose>
            <text macro="label-number-capitalized"/>
          </group>
          <group delimiter=" ">
            <text variable="volume"/>
            <text variable="container-title"/>
            <text variable="page-first"/>
          </group>
        </group>
      </if>
      <else>
        <group delimiter=" ">
          <text variable="volume"/>
          <text variable="container-title"/>
          <choose>
            <if variable="section">
              <text macro="label-section-symbol"/>
            </if>
            <else>
              <text variable="page-first"/>
            </else>
          </choose>
        </group>
      </else>
    </choose>
  </macro>
  <macro name="legal-source-regulation">
    <group delimiter=", ">
      <group delimiter=" ">
        <text variable="genre"/>
        <text macro="label-number-capitalized"/>
      </group>
      <group delimiter=" ">
        <text variable="volume"/>
        <text variable="container-title"/>
        <choose>
          <if variable="section">
            <text macro="label-section-symbol"/>
          </if>
          <else>
            <text variable="page-first"/>
          </else>
        </choose>
      </group>
    </group>
  </macro>
  <macro name="legal-source-treaty">
    <group delimiter=" ">
      <number variable="volume"/>
      <text variable="container-title"/>
      <choose>
        <if match="any" variable="page page-first">
          <text variable="page-first"/>
        </if>
        <else>
          <text macro="label-number-capitalized"/>
        </else>
      </choose>
    </group>
  </macro>
  <!-- Citation -->
  <citation collapse="year" disambiguate-add-givenname="true" disambiguate-add-names="true" disambiguate-add-year-suffix="true" et-al-min="3" et-al-use-first="1" givenname-disambiguation-rule="primary-name-with-initials">
    <sort>
      <key macro="author-sort" names-min="3" names-use-first="1"/>
      <key macro="date-sort-group"/>
      <key macro="date-sort"/>
      <key variable="status"/>
    </sort>
    <layout delimiter="; " prefix="(" suffix=")">
      <group delimiter=", ">
        <text macro="author-short"/>
        <text macro="date-short"/>
        <text macro="label-locator"/>
      </group>
    </layout>
  </citation>
  <!-- Bibliography -->
  <macro name="bibliography">
    <group delimiter=" ">
      <choose>
        <if match="any" type="bill hearing legal_case legislation regulation treaty">
          <!-- Legal items have different orders and delimiters -->
          <text macro="legal-reference" suffix="."/>
          <text macro="source-DOI-URL"/>
          <text variable="references"/>
        </if>
        <else>
          <group delimiter=". " suffix=".">
            <text macro="author-and-contributors"/>
            <text macro="date"/>
            <text macro="title-and-descriptions"/>
            <text macro="source"/>
          </group>
          <text macro="source-DOI-URL"/>
          <text macro="publication-history"/>
        </else>
      </choose>
    </group>
  </macro>
  <bibliography entry-spacing="0" et-al-min="21" et-al-use-first="19" et-al-use-last="true" hanging-indent="true" line-spacing="2">
    <sort>
      <key macro="author-sort"/>
      <key macro="date-sort-group"/>
      <key macro="date-sort"/>
      <key variable="status"/>
      <key macro="title"/>
      <key variable="volume"/>
      <key variable="part-number"/>
      <key variable="event-date"/>
      <key variable="original-date"/>
      <key macro="source-archive"/>
    </sort>
    <layout>
      <choose>
        <if match="any" variable="archive archive-place container-title DOI number publisher references URL">
          <text macro="bibliography"/>
        </if>
        <!-- an inaccessible \`interview\` or \`personal_communication\` is cited in-text only (APA 8.9) -->
        <else-if match="any" type="interview personal_communication"/>
        <else>
          <text macro="bibliography"/>
        </else>
      </choose>
    </layout>
  </bibliography>
</style>
`

export const ZH_CN_LOCALE_XML = `
<?xml version="1.0" encoding="utf-8"?>
<!-- 来源：https://github.com/citation-style-language/locales/blob/master/locales-zh-CN.xml （CC BY-SA 3.0） -->
<locale xmlns="http://purl.org/net/xbiblio/csl" version="1.0" xml:lang="zh-CN">
  <info>
    <translator>
      <name>rongls</name>
    </translator>
    <translator>
      <name>sati-bodhi</name>
    </translator>
    <translator>
      <name>Heromyth</name>
    </translator>
    <translator>
      <name>Zeping Lee</name>
    </translator>
    <translator>
      <name>韩小土</name>
    </translator>
    <translator>
      <name>韩敏义</name>
    </translator>
    <rights license="http://creativecommons.org/licenses/by-sa/3.0/">This work is licensed under a Creative Commons Attribution-ShareAlike 3.0 License</rights>
    <updated>2025-10-16T11:24:00+08:00</updated>
  </info>
  <style-options punctuation-in-quote="false"/>
  <date form="text">
    <date-part name="year" suffix="年" range-delimiter="&#8212;"/>
    <date-part name="month" form="numeric" suffix="月" range-delimiter="&#8212;"/>
    <date-part name="day" suffix="日" range-delimiter="&#8212;"/>
  </date>
  <date form="numeric">
    <date-part name="year" range-delimiter="/"/>
    <date-part name="month" form="numeric-leading-zeros" prefix="-" range-delimiter="/"/>
    <date-part name="day" form="numeric-leading-zeros" prefix="-" range-delimiter="/"/>
  </date>
  <terms>
    <!-- LONG GENERAL TERMS -->
    <term name="accessed">见于</term>
    <term name="advance-online-publication">网络首发</term>
    <term name="album">专辑</term>
    <term name="and">和</term>
    <term name="and others">及其他</term>
    <term name="anonymous">作者不详</term>
    <term name="at">于</term>
    <term name="audio-recording">录音</term>
    <term name="available at">载于</term>
    <term name="by">著</term>
    <term name="circa">介于</term>
    <term name="cited">见引于</term>
    <term name="et-al">等</term>
    <term name="film">电影</term>
    <term name="forthcoming">即将出版</term>
    <term name="from">从</term>
    <term name="henceforth">从此以后</term>
    <term name="ibid">同上</term>
    <term name="in">收入</term>
    <term name="in press">送印中</term>
    <term name="internet">网际网络</term>
    <term name="letter">信函</term>
    <term name="loc-cit">同前注</term>
    <term name="no date">日期不详</term>
    <term name="no-place">出版地不详</term>
    <term name="no-publisher">出版者不详</term> <!-- sine nomine -->
    <term name="on">在</term>
    <term name="online">在线</term>
    <term name="op-cit">同前注</term>
    <term name="original-work-published">原著出版于</term>
    <term name="personal-communication">的私人交流</term>
    <term name="podcast">播客</term>
    <term name="podcast-episode">播客集</term>
    <term name="preprint">预印本</term>
    <term name="presented at">发表于</term>
    <term name="radio-broadcast">电台广播</term>
    <term name="radio-series">广播剧</term>
    <term name="radio-series-episode">广播剧集</term>
    <term name="reference">参考</term>
    <term name="retrieved">取读于</term>
    <term name="review-of">评论</term>
    <term name="scale">比例</term>
    <term name="special-issue">特刊</term>
    <term name="special-section">特稿</term>
    <term name="television-broadcast">电视广播</term>
    <term name="television-series">电视剧</term>
    <term name="television-series-episode">电视剧集</term>
    <term name="video">视频</term>
    <term name="working-paper">工作论文</term>

    <!-- SHORT GENERAL TERMS -->
    <term name="anonymous" form="short">无名氏</term>
    <term name="circa" form="short">约</term>
    <term name="no date" form="short">不详</term>
    <term name="no-place" form="short">出版地不详</term>
    <term name="no-publisher" form="short">出版者不详</term>
    <term name="reference" form="short">参</term>
    <term name="review-of" form="short">评</term>

    <!-- SYMBOLIC GENERAL FORMS -->

    <!-- LONG ITEM TYPE FORMS -->
    <term name="article">预印本</term>
    <term name="article-journal">期刊文章</term>
    <term name="article-magazine">杂志文章</term>
    <term name="article-newspaper">报纸文章</term>
    <term name="bill">法案</term>
    <!-- book is in the list of locator terms -->
    <term name="broadcast">广播</term>
    <!-- chapter is in the list of locator terms -->
    <term name="classic">古籍</term>
    <term name="collection">馆藏</term>
    <term name="dataset">数据集</term>
    <term name="document">文档</term>
    <term name="entry">词条</term>
    <term name="entry-dictionary">字典词条</term>
    <term name="entry-encyclopedia">百科词条</term>
    <term name="event">活动</term>
    <!-- figure is in the list of locator terms -->
    <term name="graphic">视觉作品</term>
    <term name="hearing">听证会</term>
    <term name="interview">访谈</term>
    <term name="legal_case">司法案例</term>
    <term name="legislation">法律</term>
    <term name="manuscript">手稿</term>
    <term name="map">地图</term>
    <term name="motion_picture">录像</term>
    <term name="musical_score">乐谱</term>
    <term name="pamphlet">小册子</term>
    <term name="paper-conference">会议论文</term>
    <term name="patent">专利</term>
    <term name="performance">演出</term>
    <term name="periodical">期刊</term>
    <term name="personal_communication">的私人交流</term>
    <term name="post">帖子</term>
    <term name="post-weblog">博客帖子</term>
    <term name="regulation">法规</term>
    <term name="report">报告</term>
    <term name="review">评论</term>
    <term name="review-book">书评</term>
    <term name="software">软件</term>
    <term name="song">录音</term>
    <term name="speech">演讲</term>
    <term name="standard">标准</term>
    <term name="thesis">学位论文</term>
    <term name="treaty">条约</term>
    <term name="webpage">网页</term>

    <!-- SHORT ITEM TYPE FORMS -->
    <term name="article-journal" form="short">期刊文章</term>
    <term name="article-magazine" form="short">杂志文章</term>
    <term name="article-newspaper" form="short">报纸文章</term>
    <!-- book is in the list of locator terms -->
    <!-- chapter is in the list of locator terms -->
    <term name="document" form="short">文档</term>
    <!-- figure is in the list of locator terms -->
    <term name="graphic" form="short">视觉作品</term>
    <term name="interview" form="short">采访</term>
    <term name="manuscript" form="short">手稿</term>
    <term name="motion_picture" form="short">录像</term>
    <term name="report" form="short">报告</term>
    <term name="review" form="short">评论</term>
    <term name="review-book" form="short">书评</term>
    <term name="song" form="short">录音</term>

    <!-- LONG VERB ITEM TYPE FORMS -->
    <!-- Only where applicable -->
    <term name="hearing" form="verb">听证会</term>
    <term name="review" form="verb">评论</term>
    <term name="review-book" form="verb">书评</term>

    <!-- SHORT VERB ITEM TYPE FORMS -->

    <!-- HISTORICAL ERA TERMS -->
    <term name="ad">公元</term>
    <term name="bc">公元前</term>
    <term name="bce">公元前</term>
    <term name="ce">公元</term>

    <!-- PUNCTUATION -->
    <term name="open-quote">《</term>
    <term name="close-quote">》</term>
    <term name="open-inner-quote">〈</term>
    <term name="close-inner-quote">〉</term>
    <term name="page-range-delimiter">～</term>
    <term name="colon">：</term>
    <term name="comma">，</term>
    <term name="semicolon">；</term>

    <!-- ORDINALS -->
    <term name="ordinal"/>

    <!-- LONG ORDINALS -->
    <term name="long-ordinal-01">一</term>
    <term name="long-ordinal-02">二</term>
    <term name="long-ordinal-03">三</term>
    <term name="long-ordinal-04">四</term>
    <term name="long-ordinal-05">五</term>
    <term name="long-ordinal-06">六</term>
    <term name="long-ordinal-07">七</term>
    <term name="long-ordinal-08">八</term>
    <term name="long-ordinal-09">九</term>
    <term name="long-ordinal-10">十</term>

    <!-- LONG LOCATOR FORMS -->
    <term name="act">幕</term>
    <term name="appendix">附录</term>
    <term name="article-locator">条</term> <!-- 用于法律，如“《公司法》第 16 条” -->
    <term name="book">册</term>
    <term name="canon">准则</term>
    <term name="chapter">章</term>
    <term name="column">栏</term>
    <term name="elocation">位置</term>
    <term name="equation">公式</term>
    <term name="figure">图表</term>
    <term name="folio">版</term>
    <term name="issue">期</term>
    <term name="line">行</term>
    <term name="note">注脚</term>
    <term name="opus">作品</term>
    <term name="page">页</term>
    <term name="paragraph">段落</term>
    <term name="part">部分</term>
    <term name="rule">规则</term>
    <term name="scene">场</term>
    <term name="section">节</term>
    <term name="sub-verbo">另见</term>
    <term name="supplement">补充</term>
    <term name="table">表格</term>
    <term name="timestamp"> <!-- generally blank -->
      <single/>
      <multiple/>
    </term>
    <term name="title-locator">编</term> <!-- 用于法律，如“《美国法典》第19编” -->
    <term name="verse">篇</term>
    <term name="volume">卷</term>

    <!-- SHORT LOCATOR FORMS -->
    <term name="appendix" form="short">附录</term>
    <term name="article-locator" form="short">条</term>
    <term name="book" form="short">册</term>
    <term name="chapter" form="short">章</term>
    <term name="column" form="short">栏</term>
    <term name="elocation" form="short">位置</term>
    <term name="equation" form="short">式</term>
    <term name="figure" form="short">图</term>
    <term name="folio" form="short">版</term>
    <term name="issue" form="short">期</term>
    <term name="line" form="short">行</term>
    <term name="note" form="short">注</term>
    <term name="opus" form="short">op.</term>
    <term name="page" form="short">页</term>
    <term name="paragraph" form="short">段</term>
    <term name="part" form="short">部</term>
    <term name="rule" form="short">规则</term>
    <term name="scene" form="short">场</term>
    <term name="section" form="short">节</term>
    <term name="sub-verbo" form="short">另见</term>
    <term name="supplement" form="short">补充</term>
    <term name="table" form="short">表</term>
    <term name="timestamp" form="short"> <!-- generally blank -->
      <single/>
      <multiple/>
    </term>
    <term name="title-locator" form="short">编</term>
    <term name="verse" form="short">篇</term>
    <term name="volume" form="short">卷</term>

    <!-- SYMBOLIC LOCATOR FORMS -->
    <term name="paragraph" form="symbol">
      <single>¶</single>
      <multiple>¶¶</multiple>
    </term>
    <term name="section" form="symbol">
      <single>§</single>
      <multiple>§§</multiple>
    </term>

    <!-- LONG NUMBER VARIABLE FORMS -->
    <term name="chapter-number">章</term>
    <term name="citation-number">引用</term>
    <term name="collection-number">册</term>
    <term name="edition">版本</term>
    <term name="first-reference-note-number">前注</term>
    <term name="number">编号</term>
    <term name="number-of-pages"> 总页数</term>
    <term name="number-of-volumes">卷</term>
    <term name="page-first">页</term>
    <term name="printing">编号</term>
    <term name="version">版</term>

    <!-- SHORT NUMBER VARIABLE FORMS -->
    <term name="chapter-number" form="short">章</term>
    <term name="citation-number" form="short">引用</term>
    <term name="collection-number" form="short">册</term>
    <term name="edition" form="short">版</term>
    <term name="first-reference-note-number" form="short">前注</term>
    <term name="number" form="short">
      <single>no.</single>
      <multiple>nos.</multiple>
    </term>
    <term name="number-of-pages" form="short">共</term>
    <term name="number-of-volumes" form="short">卷</term>
    <term name="page-first" form="short">页</term>
    <term name="printing" form="short">编号</term>

    <!-- LONG ROLE FORMS -->
    <term name="author"/> <!-- generally blank -->
    <term name="chair">主席</term>
    <term name="collection-editor">总编辑</term>
    <term name="compiler">编撰</term>
    <term name="composer"/> <!-- generally blank -->
    <term name="container-author"/> <!-- generally blank -->
    <term name="contributor">贡献者</term>
    <term name="curator">策展人</term>
    <term name="director">导演</term>
    <term name="editor">编辑</term>
    <term name="editor-translator">编译</term>
    <term name="editortranslator">编译</term>
    <term name="editorial-director">主编</term>
    <term name="executive-producer">监制</term>
    <term name="guest">嘉宾</term>
    <term name="host">主持</term>
    <term name="illustrator">绘图</term>
    <term name="interviewer"/> <!-- generally blank -->
    <term name="narrator">朗读者</term>
    <term name="organizer">组织者</term>
    <term name="original-author"/> <!-- generally blank -->
    <term name="performer">表演</term>
    <term name="producer">制片人</term>
    <term name="recipient"/> <!-- generally blank -->
    <term name="reviewed-author"/> <!-- generally blank -->
    <term name="script-writer">编剧</term>
    <term name="series-creator">创作</term>
    <term name="translator">翻译</term>

    <!-- SHORT ROLE FORMS -->
    <term name="compiler" form="short">编</term>
    <term name="contributor" form="short">贡献</term>
    <term name="curator" form="short">策展</term>
    <term name="director" form="short">导演</term>
    <term name="editor" form="short">编</term>
    <term name="editor-translator" form="short">编译</term>
    <term name="editortranslator" form="short">编译</term>
    <term name="editorial-director" form="short">主编</term>
    <term name="executive-producer" form="short">监制</term>
    <term name="illustrator" form="short">绘</term>
    <term name="narrator" form="short">朗读</term>
    <term name="organizer" form="short">组织</term>
    <term name="performer" form="short">表演</term>
    <term name="producer" form="short">制片人</term>
    <term name="script-writer" form="short">编剧</term>
    <term name="series-creator" form="short">创作</term>
    <term name="translator" form="short">译</term>

    <!-- VERB ROLE FORMS -->
    <term name="chair" form="verb">主席</term>
    <term name="collection-editor" form="verb">总编辑</term>
    <term name="compiler" form="verb">编撰</term>
    <term name="container-author" form="verb">著</term>
    <term name="contributor" form="verb">贡献</term>
    <term name="curator" form="verb">策展</term>
    <term name="director" form="verb">指导</term>
    <term name="editor" form="verb">编辑</term>
    <term name="editor-translator" form="verb">编译</term>
    <term name="editortranslator" form="verb">编译</term>
    <term name="editorial-director" form="verb">主编</term>
    <term name="executive-producer" form="verb">监制</term>
    <term name="guest" form="verb">嘉宾</term>
    <term name="host" form="verb">主持</term>
    <term name="illustrator" form="verb">绘图</term>
    <term name="interviewer" form="verb">采访</term>
    <term name="narrator" form="verb">朗读</term>
    <term name="organizer" form="verb">组织</term>
    <term name="performer" form="verb">表演</term>
    <term name="producer" form="verb">制片</term>
    <term name="recipient" form="verb">受函</term>
    <term name="reviewed-author" form="verb">校订</term>
    <term name="script-writer" form="verb">编剧</term>
    <term name="series-creator" form="verb">创作</term>
    <term name="translator" form="verb">翻译</term>

    <!-- SHORT VERB ROLE FORMS -->
    <term name="collection-editor" form="verb-short">总编</term>
    <term name="compiler" form="verb-short">编</term>
    <term name="contributor" form="verb-short">贡献</term>
    <term name="curator" form="verb-short">策展</term>
    <term name="director" form="verb-short">导</term>
    <term name="editor" form="verb-short">编</term>
    <term name="editor-translator" form="verb-short">编译</term>
    <term name="editortranslator" form="verb-short">编译</term>
    <term name="editorial-director" form="verb-short">主编</term>
    <term name="executive-producer" form="verb-short">监制</term>
    <term name="guest" form="verb-short">嘉宾</term>
    <term name="host" form="verb-short">主持</term>
    <term name="illustrator" form="verb-short">绘</term>
    <term name="narrator" form="verb-short">朗读</term>
    <term name="organizer" form="verb-short">组织</term>
    <term name="performer" form="verb-short">表演</term>
    <term name="producer" form="verb-short">制片</term>
    <term name="reviewed-author" form="verb-short">校</term>
    <term name="script-writer" form="verb-short">编剧</term>
    <term name="series-creator" form="verb-short">创作</term>
    <term name="translator" form="verb-short">译</term>

    <!-- LONG MONTH FORMS -->
    <term name="month-01">一月</term>
    <term name="month-02">二月</term>
    <term name="month-03">三月</term>
    <term name="month-04">四月</term>
    <term name="month-05">五月</term>
    <term name="month-06">六月</term>
    <term name="month-07">七月</term>
    <term name="month-08">八月</term>
    <term name="month-09">九月</term>
    <term name="month-10">十月</term>
    <term name="month-11">十一月</term>
    <term name="month-12">十二月</term>

    <!-- SHORT MONTH FORMS -->
    <term name="month-01" form="short">1月</term>
    <term name="month-02" form="short">2月</term>
    <term name="month-03" form="short">3月</term>
    <term name="month-04" form="short">4月</term>
    <term name="month-05" form="short">5月</term>
    <term name="month-06" form="short">6月</term>
    <term name="month-07" form="short">7月</term>
    <term name="month-08" form="short">8月</term>
    <term name="month-09" form="short">9月</term>
    <term name="month-10" form="short">10月</term>
    <term name="month-11" form="short">11月</term>
    <term name="month-12" form="short">12月</term>

    <!-- SEASONS -->
    <term name="season-01">春</term>
    <term name="season-02">夏</term>
    <term name="season-03">秋</term>
    <term name="season-04">冬</term>
  </terms>
</locale>
`

